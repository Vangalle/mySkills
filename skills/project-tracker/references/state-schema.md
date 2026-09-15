# PROJECT_STATE contracts

## Current v2: goal → logical design history → progress

Use v2 for reviewed logical-history definitions. Keep existing v1 readable; do not
silently migrate live State. `state migrate [path]` emits a proposal only, preserves
legacy status and verification, leaves Project Goal null and ancestry unknown.

A v2 proposal contains `schemaVersion: 2`, `baseline`, `releaseState`, `boundaries`,
`verification`, `references`, `projectGoal`, `goals` and optional `legacyStatus`.
The baseline, verification and reference shapes below still apply. Project Goal:

```json
{
  "statement": "项目要解决的问题与长期方向",
  "reasoning": "理念与市场需求如何共同导出目标",
  "philosophy": { "path": "PHILOSOPHY.md", "evidenceId": "document:<observed-id>" },
  "market": { "path": "MARKET.md", "evidenceId": "document:<observed-id>" }
}
```

Use actual matching observed document IDs, never the placeholders above. Missing
origins require `projectGoal: null`, not an inferred milestone or code summary.
Each feature goal has `id`, `title`, and designs. Each design has `id`, `title`,
`path`, optional `taskPaths`, `parents`, `acceptance`, and `progress`:

- `parents: null`: ancestry not recorded; `[]`: explicit logical root; otherwise
  explicit parent design IDs within that feature goal. Forks and merges are valid;
  cycles, missing/self parents and duplicate IDs are rejected. Never infer links.
- `acceptance` uses the criterion structure below. Definitions and `complete`
  changes require review; current criterion-specific PASS is still necessary.
- `progress` contains append-only observations with the strict shape in
  [automatic records](progress-recording.md). All history IDs start with an ASCII
  letter/digit, contain only letters/digits/`.`/`_`/`-`, and are at most 120 chars.
  Timestamps are ISO with timezone; Git refs are real hexadecimal commit IDs.
- Preserve existing records, historical verification and its original bindings,
  human notes and `legacyStatus`; historical evidence is not current acceptance.

A readable Markdown renderer stores v2 headings/tables. Do not invent a second
JSON state file or a graph database. `proposal.json` is an internal transient
input. Generated v2 sections must use the renderer's canonical format; put manual
prose in separate top-level human sections. Extra paragraphs/tables/fields in a
generated section are refused rather than silently discarded. Preserve the file
and arrange a reviewed repair; do not bypass that refusal with a direct rewrite.
The CLI validates exact contracts and refuses unsupported versions.

## Legacy v1 proposal

A legacy proposal records two separate dimensions: **status** says whether work is
stable or still moving, while **claim maturity** says the environment in which
the claimed result has actually been demonstrated. A stable demo is still a
demo; it is not production evidence.

The `proposal.json` you produce during `refresh` must validate against the
backend schema. The backend rejects anything below.

```json
{
  "schemaVersion": 1,
  "baseline": { "branch": "main", "commit": "<full HEAD sha>", "verifiedAt": "<ISO date>" },
  "releaseState": "STABLE | ACTIVE | BLOCKED",
  "executiveSummary": "one paragraph, current conclusions only",
  "currentMilestone": {
    "objective": "the single current objective",
    "exitCriteria": ["at least one concrete, checkable criterion"]
  },
  "workstreams": [
    {
      "name": "area name",
      "status": "STABLE | ACTIVE | BLOCKED | PLANNED | DEFERRED",
      "claimMaturity": "CODE_EXISTS | DEMO_VERIFIED | LOCAL_PROTOTYPE_VERIFIED | PRODUCTION_VERIFIED",
      "stableBaseline": "what works today, qualified by maturity",
      "currentGap": "what is missing",
      "evidenceIds": ["must exist in evidence.json references"]
    }
  ],
  "activeWork": [
    {
      "name": "item name",
      "status": "ACTIVE | BLOCKED",
      "completed": ["evidence-backed completed steps"],
      "remaining": ["not-yet-done steps"],
      "definitionOfDone": ["checkable completion conditions"],
      "evidenceIds": []
    }
  ],
  "risks": [
    {
      "severity": "P0 | P1 | P2",
      "problem": "what is wrong",
      "impact": "consequence",
      "nextAction": "single concrete next step",
      "evidenceIds": []
    }
  ],
  "verification": [
    { "command": "npm test", "result": "PASS", "exitCode": 0, "verifiedAt": "ISO", "outputSummary": "..." }
  ],
  "nextActions": [{ "priority": "P0 | P1 | P2", "action": "..." }],
  "boundaries": [
    {
      "statement": "copy the current marked project boundary exactly",
      "evidenceIds": ["boundary:agents:<stable-id>"]
    }
  ],
  "references": [{ "label": "state", "path": "repo-relative path only" }]
}
```

## Hard rules for legacy v1

- Legacy `schemaVersion` is `1`; current logical-history State uses `2`.
- `currentMilestone.exitCriteria` must not be empty.
- At most 3 `ACTIVE` items in `activeWork`.
- At most 10 `nextActions`.
- Every `evidenceIds` entry must exist in the evidence bundle's references.
- Every workstream must declare `claimMaturity`.
- `STABLE` workstreams must cite at least one evidence id, and commit-only
  evidence cannot support `STABLE`.
- Every current marked project boundary must appear in `boundaries` with its
  exact statement and evidence id.
- Reference paths must be repo-relative (no absolute paths, no `..`).
- A P0 conflict forces `releaseState: BLOCKED` (backend downgrades
  automatically during preview).

## Claim maturity

- `CODE_EXISTS` — code or a commit exists; no working behavior is claimed.
- `DEMO_VERIFIED` — the behavior was demonstrated with isolated demo or
  synthetic data.
- `LOCAL_PROTOTYPE_VERIFIED` — the local prototype path and its checks were
  verified; names such as `real-*` do not raise this to production.
- `PRODUCTION_VERIFIED` — direct production-environment evidence exists and the
  user has explicitly confirmed that production scope. Never infer this from a
  commit name, green local tests, or a local database.

## Evidence confidence

- `normative` — an explicitly marked user/project boundary; other evidence may
  add implementation detail but may not contradict it.
- `observed` — current Git/verification/filesystem facts.
- `reported` — claims from commit subjects, sessions with tool output, or the
  verified baseline.
- `inferred` — semantic guesses from assistant text; never enough for
  "completed" conclusions, and never for STABLE.

Conclusions from assistant messages with `stopReason: "error"` or `"aborted"`
are risk evidence only. Abandoned session branches are historical context.

## Declaring project boundaries

The backend reads only an explicit block in the repository-root `AGENTS.md`;
it never guesses boundaries from arbitrary prose:

```markdown
<!-- project-tracker:boundaries -->
- The market is a demo/prototype, not a real transaction system.
- The routing layer is unfinished.
<!-- /project-tracker:boundaries -->
```

These statements enter the bounded bundle before lower-priority session and
commit details, and must be copied into the proposal without changing their
meaning.

## Legacy optional goals and shared design acceptance

Old proposals remain valid without `goals`. Reference original source files;
never copy an entire design or task list into state.

```json
{
  "goals": [{
    "id": "reliable-login",
    "title": "可靠登录",
    "designs": [{
      "id": "password-login",
      "title": "密码登录",
      "path": "openspec/changes/login/design.md",
      "taskPaths": ["openspec/changes/login/tasks.md"],
      "acceptance": [{
        "id": "reject-invalid",
        "criterion": "无效密码不能创建会话",
        "complete": false,
        "evidenceIds": []
      }]
    }]
  }]
}
```

`complete: true` needs a matching observed verification reference and a current
PASS record in scan evidence. Copy its stable ID and full record from the scan;
never invent them or reuse IDs from an older run. The UI counts supported
acceptance items, while source task checkboxes have a separate count. A generic
passing command is not semantic proof of every criterion; associate evidence
only with the behavior it tested.

Verification records may include `id`, `binding` (projectRoot, head,
contentFingerprint, stable), and `freshness` (current, stale, unbound).
New v1 renders include optional metadata to preserve exact verification values.
Old bare tables cannot recover IDs, bindings or exit codes they never stored;
missing exit codes remain null. Unbound results cannot support acceptance.
