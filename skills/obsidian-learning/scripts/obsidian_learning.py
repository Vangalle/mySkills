#!/usr/bin/env python3
"""Deterministic filesystem helper for the obsidian-learning skill."""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_CONFIG = Path.home() / ".config" / "obsidian-learner" / "config.json"


def canonical(path: Path | str, *, must_exist: bool = True) -> Path:
    candidate = Path(path).expanduser().resolve()
    if must_exist and not candidate.exists():
        raise ValueError(f"path does not exist: {candidate}")
    return candidate


def is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def _default_search_roots() -> list[Path]:
    home = Path.home()
    icloud_obsidian_root = (
        home
        / "Library"
        / "Mobile Documents"
        / "iCloud~md~obsidian"
        / "Documents"
    )
    mobile_documents = home / "Library" / "Mobile Documents"
    candidates = [
        icloud_obsidian_root if icloud_obsidian_root.is_dir() else mobile_documents,
        home / "Documents",
        home / "Obsidian",
    ]
    return [path.resolve() for path in candidates if path.is_dir()]


def _find_markers(search_root: Path) -> list[Path]:
    """Find `.obsidian` directories using find piped through grep."""
    root = canonical(search_root)
    try:
        find_result = subprocess.run(
            ["find", str(root), "-type", "d", "-name", ".obsidian", "-print", "-prune"],
            check=False,
            capture_output=True,
            text=True,
        )
        grep_result = subprocess.run(
            ["grep", "-E", r"/\.obsidian$"],
            check=False,
            input=find_result.stdout,
            capture_output=True,
            text=True,
        )
        if find_result.returncode != 0:
            raise OSError(find_result.stderr.strip() or "find failed")
        if grep_result.returncode not in (0, 1):
            raise OSError(grep_result.stderr.strip() or "grep failed")
        return sorted(
            {Path(line).resolve() for line in grep_result.stdout.splitlines() if line.strip()},
            key=str,
        )
    except FileNotFoundError:
        # Keep the helper usable on minimal systems while preferring find+grep.
        markers: list[Path] = []
        for directory, names, _files in os.walk(root):
            if ".obsidian" in names:
                markers.append((Path(directory) / ".obsidian").resolve())
                names.remove(".obsidian")
        return sorted(set(markers), key=str)


def discover(search_roots: list[Path] | None = None) -> dict[str, Any]:
    roots_to_scan = search_roots if search_roots is not None else _default_search_roots()
    markers: set[Path] = set()
    searched: list[str] = []
    errors: list[dict[str, str]] = []

    for supplied_root in roots_to_scan:
        try:
            root = canonical(supplied_root)
            if not root.is_dir():
                raise ValueError(f"not a directory: {root}")
            searched.append(str(root))
            markers.update(
                marker for marker in _find_markers(root) if marker.parent != root
            )
        except (OSError, ValueError) as error:
            errors.append({"path": str(Path(supplied_root).expanduser()), "error": str(error)})

    vault_paths = sorted({marker.parent for marker in markers}, key=str)
    root_paths = sorted({vault.parent for vault in vault_paths}, key=str)
    return {
        "searched": searched,
        "roots": [str(path) for path in root_paths],
        "vaults": [{"name": path.name, "path": str(path)} for path in vault_paths],
        "errors": errors,
        "requiresConfirmation": True,
    }


def _empty_config() -> dict[str, Any]:
    return {
        "configured": False,
        "obsidianRoot": None,
        "vaults": [],
        "staleVaults": [],
    }


def load_config(path: Path = DEFAULT_CONFIG) -> dict[str, Any]:
    config_path = Path(path).expanduser()
    if not config_path.exists():
        return _empty_config()

    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read config {config_path}: {error}") from error

    if not isinstance(raw, dict):
        raise ValueError(f"invalid config {config_path}: top level must be an object")
    root_value = raw.get("obsidianRoot")
    vault_values = raw.get("vaults", [])
    if not isinstance(root_value, str) or not root_value.strip():
        raise ValueError(f"invalid config {config_path}: obsidianRoot must be a path string")
    if not isinstance(vault_values, list):
        raise ValueError(f"invalid config {config_path}: vaults must be a list")

    root = canonical(root_value, must_exist=False)
    if not root.is_dir():
        raise ValueError(f"configured Obsidian root is not a directory: {root}")

    valid_vaults: list[dict[str, str]] = []
    stale: list[str] = []
    for index, item in enumerate(vault_values):
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            raise ValueError(f"invalid config {config_path}: vaults[{index}].path must be a string")
        vault = canonical(item["path"], must_exist=False)
        if vault == root:
            raise ValueError(f"Obsidian root cannot also be a vault: {vault}")
        if not is_within(vault, root):
            raise ValueError(f"configured vault is outside Obsidian root: {vault}")
        if vault.is_dir() and (vault / ".obsidian").is_dir():
            valid_vaults.append({"name": vault.name, "path": str(vault)})
        else:
            stale.append(str(vault))

    valid_vaults.sort(key=lambda item: item["path"])
    stale.sort()
    return {
        "configured": True,
        "obsidianRoot": str(root),
        "vaults": valid_vaults,
        "staleVaults": stale,
    }


def _atomic_json_write(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_name, path)
    finally:
        try:
            os.unlink(temporary_name)
        except FileNotFoundError:
            pass


def save_config(path: Path, root: Path, vaults: list[Path]) -> dict[str, Any]:
    root_path = canonical(root)
    if not root_path.is_dir():
        raise ValueError(f"Obsidian root is not a directory: {root_path}")

    records: list[dict[str, str]] = []
    for supplied_vault in vaults:
        vault = canonical(supplied_vault)
        if vault == root_path:
            raise ValueError(f"Obsidian root cannot also be a vault: {vault}")
        if not vault.is_dir() or not (vault / ".obsidian").is_dir():
            raise ValueError(f"not an Obsidian vault: {vault}")
        if not is_within(vault, root_path):
            raise ValueError(f"vault is outside Obsidian root: {vault}")
        records.append({"name": vault.name, "path": str(vault)})

    result = {
        "configured": True,
        "obsidianRoot": str(root_path),
        "vaults": sorted(records, key=lambda item: item["path"]),
        "staleVaults": [],
    }
    _atomic_json_write(Path(path).expanduser(), result)
    return result


def _configured_vault_paths(config: dict[str, Any]) -> list[Path]:
    return [canonical(item["path"]) for item in config.get("vaults", [])]


def _ancestor_vault(cwd: Path) -> Path | None:
    current = cwd
    while True:
        if (current / ".obsidian").is_dir():
            return current
        if current.parent == current:
            return None
        current = current.parent


def resolve_context(
    config: dict[str, Any], cwd: Path, selected_vault: Path | None = None
) -> dict[str, Any]:
    current = canonical(cwd)
    if not current.is_dir():
        raise ValueError(f"current working directory is not a directory: {current}")

    configured = _configured_vault_paths(config)
    root = canonical(config["obsidianRoot"])
    active = _ancestor_vault(current)
    if active == root:
        active = None
    if active is not None:
        return {
            "requiresSelection": False,
            "activeVault": str(active),
            "scope": str(current),
            "vaults": [{"name": path.name, "path": str(path)} for path in configured],
        }

    if selected_vault is not None:
        selected = canonical(selected_vault)
        if selected not in configured:
            raise ValueError(f"selected vault is not in confirmed configuration: {selected}")
        if not (selected / ".obsidian").is_dir():
            raise ValueError(f"not an Obsidian vault: {selected}")
        return {
            "requiresSelection": False,
            "activeVault": str(selected),
            "scope": str(selected),
            "vaults": [{"name": path.name, "path": str(path)} for path in configured],
        }

    return {
        "requiresSelection": True,
        "activeVault": None,
        "scope": None,
        "vaults": [{"name": path.name, "path": str(path)} for path in configured],
    }


def _scope_is_hidden(scope: Path) -> bool:
    vault = _ancestor_vault(scope)
    if vault is not None:
        return any(part.startswith(".") for part in scope.relative_to(vault).parts)
    return scope.name.startswith(".")


def validate_style(vault: Path) -> Path:
    vault_path = canonical(vault)
    if not vault_path.is_dir() or not (vault_path / ".obsidian").is_dir():
        raise ValueError(f"not an Obsidian vault: {vault_path}")
    style = vault_path / ".obsidian-learning-style.md"
    if style.is_symlink():
        raise ValueError(f"style file must not be a symlink: {style}")
    if style.exists() and not style.is_file():
        raise ValueError(f"style path is not a file: {style}")
    return style


def validate_note(scope: Path, note: Path) -> Path:
    scope_path = canonical(scope)
    note_path = canonical(note)
    if not scope_path.is_dir():
        raise ValueError(f"note scope is not a directory: {scope_path}")
    if _scope_is_hidden(scope_path):
        raise ValueError(f"hidden directory is not an eligible note scope: {scope_path}")
    if not note_path.is_file() or note_path.suffix.lower() != ".md":
        raise ValueError(f"not a Markdown note: {note_path}")
    if not is_within(note_path, scope_path):
        raise ValueError(f"note is outside active scope: {note_path}")
    if any(part.startswith(".") for part in note_path.relative_to(scope_path).parts):
        raise ValueError(f"hidden note is outside the eligible note set: {note_path}")
    if note_path.name == ".obsidian-learning-style.md":
        raise ValueError("the style guide is not a candidate note")
    return note_path


def eligible_notes(scope: Path) -> list[Path]:
    scope_path = canonical(scope)
    if not scope_path.is_dir():
        raise ValueError(f"note scope is not a directory: {scope_path}")
    if _scope_is_hidden(scope_path):
        return []

    notes: list[Path] = []
    for directory, names, files in os.walk(scope_path, followlinks=False):
        names[:] = sorted(name for name in names if not name.startswith("."))
        parent = Path(directory)
        for filename in sorted(files):
            if filename.startswith(".") or not filename.lower().endswith(".md"):
                continue
            candidate = parent / filename
            try:
                notes.append(validate_note(scope_path, candidate))
            except ValueError:
                continue
    return sorted(set(notes), key=str)


def sample_notes(
    scope: Path, limit: int = 10, seed: int | None = None
) -> list[Path]:
    if limit < 1:
        raise ValueError("sample limit must be positive")
    notes = eligible_notes(scope)
    if len(notes) <= limit:
        return notes
    selected = random.Random(seed).sample(notes, limit)
    return sorted(selected, key=str)


def _read_note(path: Path, maximum_bytes: int = 512_000) -> str:
    with path.open("rb") as handle:
        return handle.read(maximum_bytes).decode("utf-8", errors="replace")


def _title_and_headings(path: Path, text: str) -> tuple[str, str]:
    headings: list[str] = []
    title = path.stem
    for line in text.splitlines():
        match = re.match(r"^#{1,6}\s+(.+?)\s*$", line)
        if match:
            heading = match.group(1)
            headings.append(heading)
            if line.startswith("# "):
                title = heading
                break
    # Include all headings even when H1 appeared before subordinate headings.
    all_headings = [
        match.group(1)
        for line in text.splitlines()
        if (match := re.match(r"^#{1,6}\s+(.+?)\s*$", line))
    ]
    return title, "\n".join(all_headings or headings)


def _query_terms(query: str) -> list[str]:
    lowered = query.casefold().strip()
    terms: set[str] = set()
    boilerplate = (
        "的基本原理",
        "工作原理",
        "基本原理",
        "请解释",
        "请说明",
        "请介绍",
        "什么是",
        "为什么",
        "请问",
        "如何",
        "怎么",
        "一下",
    )
    for token in re.findall(r"[a-z0-9_-]+|[\u3400-\u9fff]+", lowered):
        if re.fullmatch(r"[\u3400-\u9fff]+", token):
            topic = token
            for phrase in boilerplate:
                topic = topic.replace(phrase, "")
            if len(topic) < 2:
                topic = token
            terms.add(topic)
            if len(topic) > 2:
                # Natural Chinese questions have no spaces. Strip common
                # question framing before exposing bounded topic n-grams.
                for size in range(2, min(6, len(topic)) + 1):
                    terms.update(
                        topic[index : index + size]
                        for index in range(len(topic) - size + 1)
                    )
        else:
            terms.add(token)
    return sorted((term for term in terms if term), key=lambda item: (-len(item), item))


def search_notes(scope: Path, query: str, limit: int = 5) -> list[dict[str, Any]]:
    if not query.strip():
        raise ValueError("search query must not be empty")
    if limit < 1:
        raise ValueError("search limit must be positive")

    scope_path = canonical(scope)
    terms = _query_terms(query)
    results: list[dict[str, Any]] = []
    for note in eligible_notes(scope_path):
        text = _read_note(note)
        title, headings = _title_and_headings(note, text)
        relative = str(note.relative_to(scope_path))
        fields = {
            "filename": note.stem.casefold(),
            "path": relative.casefold(),
            "title": title.casefold(),
            "headings": headings.casefold(),
            "body": text.casefold(),
        }
        weights = {"filename": 12, "title": 10, "path": 5, "headings": 4, "body": 1}
        score = 0
        matched: list[str] = []
        for field, value in fields.items():
            hits = sum(1 for term in terms if term and term in value)
            if hits:
                score += weights[field] * hits
                matched.append(field)
        results.append(
            {
                "path": str(note),
                "title": title,
                "score": score,
                "matched": matched,
            }
        )

    results.sort(key=lambda item: (-item["score"], item["path"]))
    return results[:limit]


def _validate_session_id(session_id: str) -> str:
    if (
        not session_id
        or len(session_id) > 128
        or session_id in {".", ".."}
        or re.fullmatch(r"[A-Za-z0-9._-]+", session_id) is None
    ):
        raise ValueError("session id must contain only letters, numbers, dots, underscores, and hyphens")
    return session_id


def _mode_path(session_id: str, temp_root: Path) -> Path:
    safe_id = _validate_session_id(session_id)
    root = Path(temp_root).expanduser().absolute()
    if not root.is_dir():
        raise ValueError(f"temporary root is not a directory: {root}")
    return root / "obsidian-learner" / safe_id / "mode.json"


def write_mode(
    session_id: str, mode: str, temp_root: Path = Path("/tmp")
) -> dict[str, Any]:
    if mode not in {"direct", "notes"}:
        raise ValueError("mode must be 'direct' or 'notes'")
    mode_file = _mode_path(session_id, temp_root)
    result = {
        "sessionId": session_id,
        "mode": mode,
        "modeFile": str(mode_file),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    _atomic_json_write(mode_file, result)
    return result


def read_mode(
    session_id: str, temp_root: Path = Path("/tmp")
) -> dict[str, Any]:
    mode_file = _mode_path(session_id, temp_root)
    if not mode_file.is_file():
        raise ValueError(f"session mode is not initialized: {mode_file}")
    try:
        result = json.loads(mode_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"cannot read session mode {mode_file}: {error}") from error
    if not isinstance(result, dict) or result.get("mode") not in {"direct", "notes"}:
        raise ValueError(f"invalid session mode in {mode_file}")
    result["modeFile"] = str(mode_file)
    return result


def _print_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    discovery = subparsers.add_parser("discover", help="find Obsidian roots and vaults")
    discovery.add_argument("--search-root", action="append", type=Path)

    config_show = subparsers.add_parser("config-show", help="show validated configuration")
    config_show.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    config_save = subparsers.add_parser("config-save", help="save user-confirmed paths")
    config_save.add_argument("--root", required=True, type=Path)
    config_save.add_argument("--vault", required=True, action="append", type=Path)
    config_save.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    context = subparsers.add_parser("context", help="resolve active vault and scope")
    context.add_argument("--cwd", type=Path, default=Path.cwd())
    context.add_argument("--vault", type=Path)
    context.add_argument("--config", type=Path, default=DEFAULT_CONFIG)

    sample = subparsers.add_parser("sample", help="select style-sample notes")
    sample.add_argument("--scope", required=True, type=Path)
    sample.add_argument("--limit", default=10, type=int)
    sample.add_argument("--seed", type=int)

    search = subparsers.add_parser("search", help="rank notes for a question")
    search.add_argument("--scope", required=True, type=Path)
    search.add_argument("--query", required=True)
    search.add_argument("--limit", default=5, type=int)

    validate = subparsers.add_parser("validate-note", help="validate a target note")
    validate.add_argument("--scope", required=True, type=Path)
    validate.add_argument("--note", required=True, type=Path)

    style = subparsers.add_parser("validate-style", help="validate the vault style path")
    style.add_argument("--vault", required=True, type=Path)

    mode_set = subparsers.add_parser("mode-set", help="set this session's interaction mode")
    mode_set.add_argument("--session-id", required=True)
    mode_set.add_argument("--mode", required=True, choices=("direct", "notes"))
    mode_set.add_argument("--temp-root", type=Path, default=Path("/tmp"))

    mode_show = subparsers.add_parser("mode-show", help="show this session's interaction mode")
    mode_show.add_argument("--session-id", required=True)
    mode_show.add_argument("--temp-root", type=Path, default=Path("/tmp"))

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "discover":
            roots = arguments.search_root
            _print_json(discover(roots))
        elif arguments.command == "config-show":
            _print_json(load_config(arguments.config))
        elif arguments.command == "config-save":
            _print_json(save_config(arguments.config, arguments.root, arguments.vault))
        elif arguments.command == "context":
            _print_json(
                resolve_context(
                    load_config(arguments.config), arguments.cwd, arguments.vault
                )
            )
        elif arguments.command == "sample":
            notes = sample_notes(arguments.scope, arguments.limit, arguments.seed)
            _print_json({"scope": str(canonical(arguments.scope)), "notes": [str(note) for note in notes]})
        elif arguments.command == "search":
            _print_json(
                {
                    "scope": str(canonical(arguments.scope)),
                    "query": arguments.query,
                    "candidates": search_notes(arguments.scope, arguments.query, arguments.limit),
                }
            )
        elif arguments.command == "validate-note":
            _print_json({"note": str(validate_note(arguments.scope, arguments.note)), "valid": True})
        elif arguments.command == "validate-style":
            style = validate_style(arguments.vault)
            _print_json({"styleFile": str(style), "exists": style.is_file(), "valid": True})
        elif arguments.command == "mode-set":
            _print_json(write_mode(arguments.session_id, arguments.mode, arguments.temp_root))
        elif arguments.command == "mode-show":
            _print_json(read_mode(arguments.session_id, arguments.temp_root))
        else:  # pragma: no cover - argparse prevents this branch
            parser.error(f"unsupported command: {arguments.command}")
        return 0
    except (OSError, ValueError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
