/**
 * Evidence builder: full-scope collection for a project (scan command core).
 */
import { readStateSnapshot } from "../state/onboarding.js";
import { StateProposalSchema, type CollectionIssue, type ProjectEvidence, type ProjectScope, type VerificationRecord } from "../contracts.js";
import type { TrackerConfig } from "../config.js";
import { collectGitEvidence } from "../adapters/git-adapter.js";
import { locatePiSessions } from "../adapters/pi/session-locator.js";
import { parsePiSession, type ParsedPiSession } from "../adapters/pi/session-parser.js";
import { parseProjectState } from "../state/markdown-parser.js";
import { buildReferences, detectConflicts } from "./conflict-detector.js";
import { extractProjectBoundaries } from "./project-boundaries.js";
import { PRINCIPLE_PATHS, readProjectDocument } from "../goals/document-source.js";
import {
  classifyVerificationRecords,
  loadVerificationStore,
} from "../verification/index.js";

export interface BuildEvidenceOptions {
  config: TrackerConfig;
  verificationRecords?: VerificationRecord[];
  /** Failures from selecting configuration before collection began. */
  initialIssues?: CollectionIssue[];
}

export async function buildProjectEvidence(
  scope: ProjectScope,
  options: BuildEvidenceOptions,
): Promise<ProjectEvidence> {
  const { config } = options;
  const issues: CollectionIssue[] = [...new Set([
    ...(config.collectionIssues ?? []), ...(options.initialIssues ?? []),
  ])];

  const onIssue = (issue: CollectionIssue) => { issues.push(issue); };
  const git = await collectGitEvidence(scope, onIssue);
  const sessionFiles = await locatePiSessions(scope, config, onIssue);
  const parsed: ParsedPiSession[] = [];
  for (const file of sessionFiles) {
    parsed.push(await parsePiSession(file, { maxTextChars: config.bundleLimits.maxTextChars, onIssue }));
  }
  // Newest sessions first.
  parsed.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  let stateMarkdown: string | null = null;
  try {
    stateMarkdown = (await readStateSnapshot(scope.root, config.stateFileName)).markdown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      issues.push({ source: "project_state", code: "state_unreadable", message: "项目进度记录没能读完整。" });
    }
  }
  const existingState = stateMarkdown === null ? undefined : parseProjectState(stateMarkdown);
  if (existingState && !StateProposalSchema.safeParse(existingState.proposal).success) {
    // Unvalidated legacy headers must not manufacture invalid evidence timestamps
    // or block the explicit onboarding route. Original bytes remain on disk.
    existingState.proposal = null; existingState.baseline = null;
    existingState.lastVerified = null; existingState.releaseState = null;
  }
  if (existingState && !existingState.proposal) {
    issues.push({ source: "project_state", code: "state_invalid", message: "项目进度记录已存在，但内容无法完整解析，请检查 PROJECT_STATE.md。" });
  }

  const documents = await Promise.all(PRINCIPLE_PATHS.map(path => readProjectDocument(scope.root, path)));
  for (const doc of documents) {
    if (doc.status === "unavailable" || doc.truncated) issues.push({
      source: doc.path === "AGENTS.md" ? "project_boundary" : "document",
      code: doc.path === "AGENTS.md" ? "boundaries_unreadable" : "document_incomplete",
      message: `${doc.path} 没能安全、完整读取。`,
    });
  }
  const agents = documents.find(doc => doc.path === "AGENTS.md");
  const boundaries = agents?.status === "available" && !agents.truncated
    ? extractProjectBoundaries(agents.preview, "AGENTS.md") : [];

  let verification: VerificationRecord[];
  if (options.verificationRecords === undefined) {
    const loaded = await loadVerificationStore(scope.root);
    verification = loaded.records;
    if (loaded.diagnostic) {
      issues.push({
        source: "verification", code: "verification_unreadable",
        message: "已有的检查记录没能读完整，请检查 .project-tracker/verification.json。",
      });
    }
  } else {
    verification = await classifyVerificationRecords(scope.root, options.verificationRecords);
  }

  const references = buildReferences({ git, sessions: parsed, existingState, boundaries, verification });
  for (const doc of documents) if (doc.evidenceId) references.push({
    id: doc.evidenceId, source: "filesystem", confidence: "observed",
    observedAt: new Date().toISOString(), locator: doc.path, summary: doc.title,
  });
  const conflicts = detectConflicts({ git, sessions: parsed, existingState, boundaries, verification });

  const evidence: ProjectEvidence = {
    schemaVersion: 1,
    collectedAt: new Date().toISOString(),
    collection: { complete: issues.length === 0, issues },
    project: { name: scope.name, root: scope.root, worktrees: scope.worktrees },
    git,
    sessions: parsed.map((s) => toSessionEvidence(s)),
    boundaries,
    documents,
    existingState: existingState ?? undefined,
    references,
    conflicts,
    verification,
  };
  return evidence;
}

/** Strip internal extended fields for the public contract. */
function toSessionEvidence(parsed: ParsedPiSession): ProjectEvidence["sessions"][number] {
  return {
    sessionId: parsed.sessionId,
    file: parsed.file,
    cwd: parsed.cwd,
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt,
    ...(parsed.name ? { name: parsed.name } : {}),
    ...(parsed.activeLeafId ? { activeLeafId: parsed.activeLeafId } : {}),
    userRequests: parsed.userRequests,
    assistantConclusions: parsed.assistantConclusions,
    compactions: parsed.compactions,
    fileOperations: parsed.fileOperations,
    verificationClaims: parsed.verificationClaims,
    parseWarnings: parsed.parseWarnings,
  };
}
