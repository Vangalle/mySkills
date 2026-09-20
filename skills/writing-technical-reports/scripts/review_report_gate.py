#!/usr/bin/env python3
"""Deterministic review gate for technical reports.

Mechanical, fail-closed validation of report drafts and reviewer JSON.
The gate enforces protocol structure and term fidelity only; it performs no
semantic inference about the report's content.
"""
import argparse
from hashlib import sha256
import json
import os
from pathlib import Path
import sys
import tempfile
from typing import Any, Optional

PROTOCOL_VERSION = 1
SCHEMA_VERSION = 1
MAX_ROUNDS = 3
EXIT_ERROR = 2
EXIT_REVISE = 10
EXIT_BLOCKED = 20
CHECK_NAMES = (
    "structure",
    "term_necessity_and_definition",
    "term_referential_consistency",
    "explanation_completeness",
    "evidence_fidelity",
)
STATE_FIELDS = {
    "protocol_version", "status", "round", "draft_sha256",
    "approved_sha256", "history",
}
REVIEW_FIELDS = {
    "schema_version", "verdict", "checks", "canonical_terms", "issues",
}
ISSUE_FIELDS = {"location", "problem", "required_change"}
TERM_FIELDS = {"referent", "canonical_term", "forbidden_variants"}
CHECK_FIELDS = {"status", "issues"}
HISTORY_FIELDS = {"round", "verdict", "issues", "forbidden_variant_hits"}
HIT_FIELDS = {"referent", "canonical_term", "variant"}
STATUS_NAMES = ("AUDIT_REQUIRED", "REVISION_REQUIRED", "RELEASED", "BLOCKED")
VERDICTS = ("PASS", "FAIL")
HEX_DIGITS = set("0123456789abcdef")


class GateError(ValueError):
    pass


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))


def read_text(path: Path, label: str) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise GateError(f"cannot read {label}: {error}") from error


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        data = json.loads(read_text(path, label))
    except json.JSONDecodeError as error:
        raise GateError(f"invalid {label} JSON: {error.msg}") from error
    if not isinstance(data, dict):
        raise GateError(f"{label} must be a JSON object")
    return data


def write_json_atomic(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            json.dump(payload, handle, ensure_ascii=False, sort_keys=True, indent=2)
            handle.write("\n")
        os.replace(temporary, path)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def digest(text: str) -> str:
    return sha256(text.encode("utf-8")).hexdigest()


def require_exact_fields(
    data: Any, fields: set, label: str
) -> None:
    if not isinstance(data, dict) or set(data) != fields:
        raise GateError(
            f"{label} must have exactly these fields: {', '.join(sorted(fields))}"
        )


def require_non_empty_string(value: Any, label: str) -> None:
    if not isinstance(value, str) or not value:
        raise GateError(f"{label} must be a non-empty string")


def validate_issue(data: Any) -> None:
    require_exact_fields(data, ISSUE_FIELDS, "issue")
    for field in sorted(ISSUE_FIELDS):
        require_non_empty_string(data[field], f"issue field {field}")


def validate_hash(value: Any, label: str, allow_none: bool = False) -> None:
    if value is None and allow_none:
        return
    valid = (
        isinstance(value, str)
        and len(value) == 64
        and set(value.lower()) <= HEX_DIGITS
    )
    if not valid:
        raise GateError(f"{label} must be a 64-character sha256 hex digest")


def validate_hit(data: Any) -> None:
    require_exact_fields(data, HIT_FIELDS, "forbidden variant hit")
    for field in sorted(HIT_FIELDS):
        require_non_empty_string(data[field], f"forbidden variant hit {field}")


def validate_terms(terms: Any) -> None:
    if not isinstance(terms, list):
        raise GateError("canonical_terms must be a list")
    referents: set[str] = set()
    for term in terms:
        require_exact_fields(term, TERM_FIELDS, "canonical term")
        referent = term["referent"]
        canonical = term["canonical_term"]
        variants = term["forbidden_variants"]
        require_non_empty_string(referent, "term referent")
        require_non_empty_string(canonical, "canonical_term")
        if referent in referents:
            raise GateError(f"duplicate term referent: {referent}")
        referents.add(referent)
        if not isinstance(variants, list):
            raise GateError("forbidden_variants must be a list")
        seen: set[str] = set()
        for variant in variants:
            require_non_empty_string(variant, "forbidden variant")
            if variant == canonical:
                raise GateError(
                    "a forbidden variant must differ from its canonical term"
                )
            if variant in seen:
                raise GateError(f"duplicate forbidden variant: {variant}")
            seen.add(variant)


def validate_review(review: dict[str, Any]) -> None:
    require_exact_fields(review, REVIEW_FIELDS, "review")
    if review["schema_version"] != SCHEMA_VERSION:
        raise GateError(f"review schema_version must be {SCHEMA_VERSION}")
    verdict = review["verdict"]
    if verdict not in VERDICTS:
        raise GateError(f"review verdict must be one of {VERDICTS}")
    checks = review["checks"]
    if not isinstance(checks, dict) or set(checks) != set(CHECK_NAMES):
        raise GateError(
            f"review checks must contain exactly: {', '.join(CHECK_NAMES)}"
        )
    aggregate: list[Any] = []
    for name in CHECK_NAMES:
        check = checks[name]
        require_exact_fields(check, CHECK_FIELDS, f"check {name}")
        status = check["status"]
        if status not in VERDICTS:
            raise GateError(f"check {name} status must be one of {VERDICTS}")
        issues = check["issues"]
        if not isinstance(issues, list):
            raise GateError(f"check {name} issues must be a list")
        for item in issues:
            validate_issue(item)
        if status == "PASS" and issues:
            raise GateError(f"check {name} passed but reported issues")
        if status == "FAIL" and not issues:
            raise GateError(f"check {name} failed but reported no issues")
        aggregate.extend(issues)
    if review["issues"] != aggregate:
        raise GateError(
            "review issues must exactly equal the check-level issues "
            f"concatenated in order: {', '.join(CHECK_NAMES)}"
        )
    failed = any(checks[name]["status"] == "FAIL" for name in CHECK_NAMES)
    if verdict == "PASS" and (failed or aggregate):
        raise GateError(
            "review verdict PASS contradicts failed checks or reported issues"
        )
    if verdict == "FAIL" and not (failed and aggregate):
        raise GateError(
            "review verdict FAIL requires at least one failed check and issue"
        )
    validate_terms(review["canonical_terms"])


def validate_state(state: dict[str, Any]) -> None:
    require_exact_fields(state, STATE_FIELDS, "state")
    if state["protocol_version"] != PROTOCOL_VERSION:
        raise GateError(f"state protocol_version must be {PROTOCOL_VERSION}")
    if state["status"] not in STATUS_NAMES:
        raise GateError(f"state status must be one of {STATUS_NAMES}")
    round_number = state["round"]
    if (
        not isinstance(round_number, int)
        or isinstance(round_number, bool)
        or not 1 <= round_number <= MAX_ROUNDS
    ):
        raise GateError(f"state round must be an integer from 1 to {MAX_ROUNDS}")
    validate_hash(state["draft_sha256"], "state draft_sha256")
    validate_hash(
        state["approved_sha256"], "state approved_sha256", allow_none=True
    )
    history = state["history"]
    if not isinstance(history, list):
        raise GateError("state history must be a list")
    for entry in history:
        require_exact_fields(entry, HISTORY_FIELDS, "history entry")
        entry_round = entry["round"]
        if (
            not isinstance(entry_round, int)
            or isinstance(entry_round, bool)
            or not 1 <= entry_round <= MAX_ROUNDS
        ):
            raise GateError(
                f"history entry round must be an integer from 1 to {MAX_ROUNDS}"
            )
        if entry["verdict"] not in VERDICTS:
            raise GateError(f"history entry verdict must be one of {VERDICTS}")
        issues = entry["issues"]
        if not isinstance(issues, list):
            raise GateError("history entry issues must be a list")
        for item in issues:
            validate_issue(item)
        hits = entry["forbidden_variant_hits"]
        if not isinstance(hits, list):
            raise GateError("history entry forbidden_variant_hits must be a list")
        for hit in hits:
            validate_hit(hit)


def find_forbidden_variants(
    draft: str, terms: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    hits = []
    for term in terms:
        canonical = term["canonical_term"]
        masked = draft.replace(canonical, "\0" * len(canonical))
        for variant in term["forbidden_variants"]:
            if variant in masked:
                hits.append({
                    "referent": term["referent"],
                    "canonical_term": canonical,
                    "variant": variant,
                })
    return hits


def cmd_start(draft_path: Path, state_path: Path) -> int:
    if state_path.exists():
        raise GateError("refusing to overwrite an existing state file")
    draft = read_text(draft_path, "draft")
    state = {
        "protocol_version": PROTOCOL_VERSION,
        "status": "AUDIT_REQUIRED",
        "round": 1,
        "draft_sha256": digest(draft),
        "approved_sha256": None,
        "history": [],
    }
    write_json_atomic(state_path, state)
    emit({"result": "AUDIT_REQUIRED", "round": 1})
    return 0


def cmd_check(draft_path: Path, state_path: Path, review_path: Path) -> int:
    draft = read_text(draft_path, "draft")
    state = load_json(state_path, "state")
    validate_state(state)
    review = load_json(review_path, "review")
    validate_review(review)
    current_hash = digest(draft)

    if state["status"] == "AUDIT_REQUIRED":
        if current_hash != state["draft_sha256"]:
            raise GateError("draft changed before its required review")
    elif state["status"] == "REVISION_REQUIRED":
        if current_hash == state["draft_sha256"]:
            raise GateError("revision requires a changed draft")
        state["round"] += 1
        state["draft_sha256"] = current_hash
    else:
        raise GateError(f"check is illegal in state {state['status']}")

    hits = find_forbidden_variants(draft, review["canonical_terms"])
    passed = review["verdict"] == "PASS" and not hits
    history_entry = {
        "round": state["round"],
        "verdict": "PASS" if passed else "FAIL",
        "issues": review["issues"],
        "forbidden_variant_hits": hits,
    }
    state["history"].append(history_entry)

    if passed:
        state["status"] = "RELEASED"
        state["approved_sha256"] = current_hash
        result, code = "RELEASE", 0
    elif state["round"] >= MAX_ROUNDS:
        state["status"] = "BLOCKED"
        result, code = "BLOCKED", EXIT_BLOCKED
    else:
        state["status"] = "REVISION_REQUIRED"
        result, code = "REVISE", EXIT_REVISE

    write_json_atomic(state_path, state)
    emit({
        "result": result,
        "round": state["round"],
        "issues": hits if hits else review["issues"],
    })
    return code


def cmd_release(draft_path: Path, state_path: Path) -> int:
    draft = read_text(draft_path, "draft")
    state = load_json(state_path, "state")
    validate_state(state)
    if state["status"] != "RELEASED":
        raise GateError(f"release is illegal in state {state['status']}")
    current_hash = digest(draft)
    if (
        state["draft_sha256"] == current_hash
        and state["approved_sha256"] == current_hash
    ):
        emit({"result": "RELEASE", "report": draft})
        return 0
    if state["round"] < MAX_ROUNDS:
        state["round"] += 1
        state["draft_sha256"] = current_hash
        state["approved_sha256"] = None
        state["status"] = "AUDIT_REQUIRED"
        write_json_atomic(state_path, state)
        raise GateError("approved draft changed; a new full review is required")
    state["status"] = "BLOCKED"
    state["draft_sha256"] = current_hash
    state["approved_sha256"] = None
    write_json_atomic(state_path, state)
    raise GateError("approved draft changed after the final review round")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="review_report_gate",
        description="Deterministic review gate for technical reports.",
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    start_parser = subcommands.add_parser(
        "start", help="open round one and require a full review"
    )
    start_parser.add_argument("--draft", required=True, type=Path)
    start_parser.add_argument("--state", required=True, type=Path)

    check_parser = subcommands.add_parser(
        "check", help="apply a completed review to the current round"
    )
    check_parser.add_argument("--draft", required=True, type=Path)
    check_parser.add_argument("--state", required=True, type=Path)
    check_parser.add_argument("--review", required=True, type=Path)

    release_parser = subcommands.add_parser(
        "release", help="publish the approved draft verbatim"
    )
    release_parser.add_argument("--draft", required=True, type=Path)
    release_parser.add_argument("--state", required=True, type=Path)
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "start":
            return cmd_start(args.draft, args.state)
        if args.command == "check":
            return cmd_check(args.draft, args.state, args.review)
        return cmd_release(args.draft, args.state)
    except GateError as error:
        emit({"result": "ERROR", "error": str(error)})
        return EXIT_ERROR


if __name__ == "__main__":
    sys.exit(main())