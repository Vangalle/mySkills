/**
 * project-tracker CLI (section 5.2 back end).
 *
 * Typed exit codes:
 *   0 ok  1 unexpected error  2 discovery (not_git/bare/not_found)
 *   3 validation failure      4 apply conflict (state_changed_since_preview)
 *   5 verification failure   6 incomplete scan
 *
 * Machine-readable commands write pure JSON to stdout; diagnostics go to
 * stderr.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { execa } from "execa";
import type { CollectionIssue, VerificationRecord } from "./contracts.js";
import { IncompleteScanError, prepareProjectContext } from "./entry/prepare.js";
import {
  ProjectEvidenceSchema,
  StateProposalSchema as ProjectStateProposalSchema,
} from "./contracts.js";
import {
  loadTrackerConfig,
  PI_SESSION_DIR_ENV,
  type TrackerConfig,
} from "./config.js";
import { discoverProject } from "./discovery/project-discovery.js";
import { buildProjectEvidence } from "./analysis/evidence-builder.js";
import { buildBoundedBundle } from "./analysis/bounded-bundle.js";
import { downgradeReleaseState } from "./analysis/conflict-detector.js";
import { parseProjectState } from "./state/markdown-parser.js";
import { renderProjectState, migrateLegacyState } from "./state/markdown-renderer.js";
import { previewStateUpdate, applyStateUpdate, fileHash, StateChangedError } from "./state/atomic-writer.js";
import { validateProposalAgainstEvidence } from "./state/state-schema.js";
import { ProgressAppendSchema, recordProgress } from "./state/record-progress.js";
import { inspectState, replacementNeedsBackup } from "./state/onboarding.js";
import { proposeChecks, applyCheckSetup, readCheckConfig, CheckSetupProposalSchema } from "./verification/setup.js";
import { startDashboard, readDashboardMarker } from "./server/server.js";
import { inspectDashboardReuse } from "./server/dashboard-reuse.js";
import { redactSessionText } from "./adapters/pi/redaction.js";
import {
  captureWorkspaceSnapshot,
  parseVerificationPayload,
  snapshotsMatch,
  writeVerificationStore,
} from "./verification/index.js";
import { registerMapCommands } from "./project-map/commands.js";

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_DISCOVERY = 2;
export const EXIT_INVALID = 3;
export const EXIT_CONFLICT = 4;
export const EXIT_VERIFY_FAIL = 5;
export const EXIT_INCOMPLETE = 6;

export interface CliIo {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "CliError";
  }
}

const defaultIo: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
};

function resolveConfig(
  options: { piSessionDir?: string },
  env: Record<string, string | undefined> = process.env,
): TrackerConfig {
  const dirOption = options.piSessionDir ?? env[PI_SESSION_DIR_ENV];
  return loadTrackerConfig(
    dirOption ? { piSessionDirs: [dirOption] } : {},
    env,
  );
}

async function scopedProject(inputPath: string, config: TrackerConfig) {
  const discovery = await discoverProject(inputPath, {
    extraProjectPaths: config.extraProjectPaths,
  });
  if (!discovery.ok) {
    throw new CliError(discovery.message, EXIT_DISCOVERY, { kind: discovery.kind });
  }
  return discovery.scope;
}

function parseJsonFile(file: string): unknown {
  if (!existsSync(file)) {
    throw new CliError(`file not found: ${file}`, EXIT_INVALID);
  }
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new CliError(`invalid JSON in ${file}: ${(error as Error).message}`, EXIT_INVALID);
  }
}

function readJsonWithSchema<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const raw = parseJsonFile(file);
  const result = schema.safeParse(raw) as
    | { success: true; data: T }
    | { success: false; error: { issues: Array<{ message: string; path: Array<string | number> }> } };
  if (!result.success) {
    const errors = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new CliError(`schema validation failed for ${file}: ${errors.join("; ")}`, EXIT_INVALID);
  }
  return result.data;
}

export async function runVerifyCommand(
  root: string,
  config: TrackerConfig,
  io: CliIo,
  options: { json?: boolean },
): Promise<number> {
  const projectConfig = (await readCheckConfig(root)).value;
  const allowlist = [
    ...new Set([...(projectConfig.verificationAllowlist ?? []), ...config.verificationAllowlist]),
  ];

  if (allowlist.length === 0) {
    io.stderr(
      "检查尚未配置（verificationAllowlist），不是项目不适用；将提供可确认的候选命令或手动配置入口，本次尚未执行检查。",
    );
    const setup = await proposeChecks(root);
    if (options.json) {
      io.stdout(JSON.stringify({ verification: [], note: "no allowlist configured", setup }));
    } else {
      io.stdout(setup.commands.length
        ? `建议的检查命令（尚未执行）：\n${setup.commands.map(c => `${c.command} — ${c.purpose}\n  script: ${c.script}`).join("\n")}\n是否创建这些默认检查？同意后使用 checks propose / checks apply --confirm。`
        : "未找到可建议的检查入口。请自行配置 .project-tracker.json 的 verificationAllowlist；记录未验证的进展不受影响。");
    }
    return EXIT_OK;
  }

  const baseline = await captureWorkspaceSnapshot(root);
  const runId = randomUUID();
  const pending: Array<Omit<VerificationRecord, "binding" | "freshness">> = [];
  for (const [index, command] of allowlist.entries()) {
    const redactedCommand = redactSessionText(command).text;
    io.stderr(`running: ${redactedCommand}`);
    try {
      const { exitCode, stdout, stderr } = await execa(command, {
        shell: true,
        cwd: root,
        reject: false,
        timeout: 10 * 60_000,
      });
      const passed = exitCode === 0;
      const rawSummary = `${stdout.slice(-500)}${stderr ? ` ${stderr.slice(-200)}` : ""}`.trim();
      pending.push({
        id: `verify:${runId}:${index}`,
        command: redactedCommand,
        result: passed ? "PASS" : "FAIL",
        exitCode: exitCode ?? null,
        verifiedAt: new Date().toISOString(),
        outputSummary: redactSessionText(rawSummary).text.slice(0, 500),
      });
    } catch (error) {
      pending.push({
        id: `verify:${runId}:${index}`,
        command: redactedCommand,
        result: "ERROR",
        exitCode: null,
        verifiedAt: new Date().toISOString(),
        outputSummary: redactSessionText((error as Error).message).text.slice(0, 500),
      });
    }
  }

  const completed = await captureWorkspaceSnapshot(root);
  const stable = snapshotsMatch(baseline, completed);
  const records: VerificationRecord[] = pending.map((record) => ({
    ...record,
    binding: { ...baseline, stable },
  }));
  await writeVerificationStore(root, records);
  const returnedRecords = records.map((record) => ({
    ...record,
    freshness: stable ? ("current" as const) : ("stale" as const),
  }));

  if (options.json) {
    io.stdout(JSON.stringify({ verification: returnedRecords }));
  } else {
    for (const record of returnedRecords) {
      io.stderr(`${record.command}: ${record.result} (${record.freshness})`);
    }
  }
  const failed = returnedRecords.some((r) => r.result !== "PASS");
  return failed ? EXIT_VERIFY_FAIL : EXIT_OK;
}

export interface CliResult {
  exitCode: number;
}

/**
 * Build the commander program with a captured exit code so `runCli` can return
 * typed exit codes instead of calling process.exit.
 */
export function buildCli(io: CliIo = defaultIo): { program: Command; run: (argv: string[]) => Promise<number> } {
  const state: { exitCode: number } = { exitCode: EXIT_OK };

  const program = new Command();
  program
    .name("project-tracker")
    .description("evidence-based local project status")
    .version("0.1.0");

  registerMapCommands(program, {
    root: async (path) => (await scopedProject(path, loadTrackerConfig())).root,
    stdout: io.stdout,
    invalid: (message) => new CliError(message, EXIT_INVALID),
  });

  program
    .command("prepare")
    .description("扫描项目，完整成功后准备好本次上下文")
    .option("--json", "输出供程序使用的扫描回执")
    .option("--request-id <uuid>", "本次调用的请求编号")
    .option("--onboarding", "允许返回需要 State 接入的独立状态，不表示正常就绪")
    .option("--pi-session-dir <dir>", "指定 Pi 会话目录")
    .argument("[path]", "项目目录", process.cwd())
    .action(async (path: string, options: { json?: boolean; requestId?: string; piSessionDir?: string; onboarding?: boolean }) => {
      const requestId = options.requestId ?? randomUUID();
      if (!z.string().uuid().safeParse(requestId).success) {
        throw new CliError("请求编号格式不对，需要有效的 UUID。", EXIT_INVALID);
      }
      const initialIssues: CollectionIssue[] = [];
      const config = loadTrackerConfig(
        options.piSessionDir ? { piSessionDirs: [options.piSessionDir] } : {},
        process.env,
        (issue) => { initialIssues.push(issue); },
      );
      const discovery = await discoverProject(path, { extraProjectPaths: config.extraProjectPaths });
      if (!discovery.ok) {
        const messages = {
          not_found: "找不到这个项目目录，请检查路径。",
          not_git: "这里不是 Git 项目目录，请指定要扫描的项目。",
          bare_repo: "这个仓库没有工作目录，请指定已检出的项目。",
        };
        throw new CliError(`${messages[discovery.kind]}\n项目：${path}`, EXIT_DISCOVERY, { kind: discovery.kind });
      }
      try {
        const ready = await prepareProjectContext(discovery.scope, { config, initialIssues, requestId, onboarding: options.onboarding });
        io.stdout(options.json ? JSON.stringify(ready) : `${ready.status === "ready" ? "扫描完成" : "已有 State 需要接入处理，并非正常就绪"}：${ready.project.name}\n项目：${ready.project.root}`);
        state.exitCode = EXIT_OK;
      } catch (error) {
        if (error instanceof IncompleteScanError) {
          io.stderr(error.message);
          for (const issue of error.issues) io.stderr(`[${issue.code}] ${issue.message}`);
        } else {
          // Never expose unvalidated source content through an error message.
          io.stderr("扫描没能完成，请检查项目文件和会话记录是否可读、格式是否正确后重试。");
        }
        state.exitCode = EXIT_INCOMPLETE;
      }
    });

  program
    .command("scan")
    .description("collect git + pi evidence for a project")
    .option("--json", "output pure JSON evidence to stdout")
    .option("--verification <file>", "inject verification records JSON from a previous `verify` run")
    .option("--pi-session-dir <dir>", "Pi session directory (overrides env/default)")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { json?: boolean; piSessionDir?: string; verification?: string }) => {
      const config = resolveConfig(options);
      const scope = await scopedProject(path, config);
      let verification: VerificationRecord[] | undefined;
      if (options.verification) {
        try {
          verification = parseVerificationPayload(parseJsonFile(options.verification));
        } catch (error) {
          throw new CliError(
            `invalid verification records in ${options.verification}: ${(error as Error).message}`,
            EXIT_INVALID,
          );
        }
      }
      const evidence = await buildProjectEvidence(scope, { config, verificationRecords: verification });
      if (options.json) {
        io.stdout(JSON.stringify(evidence));
      } else {
        io.stdout(
          [
            `project: ${evidence.project.name} (${evidence.project.root})`,
            `branch: ${evidence.git.branch ?? "detached"} @ ${evidence.git.head.slice(0, 10)}`,
            `dirty paths: ${evidence.git.changed.length}`,
            `sessions: ${evidence.sessions.length}`,
            `conflicts: ${evidence.conflicts.length}`,
            `references: ${evidence.references.length}`,
          ].join("\n"),
        );
        for (const conflict of evidence.conflicts) {
          io.stderr(`[${conflict.severity}] ${conflict.kind}: ${conflict.description}`);
        }
      }
      state.exitCode = EXIT_OK;
    });

  const evidenceCmd = program.command("evidence").description("evidence operations");
  evidenceCmd
    .command("bundle")
    .description("output the bounded model bundle")
    .option("--json", "output bundle as JSON")
    .option("--pi-session-dir <dir>", "Pi session directory (overrides env/default)")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { json?: boolean; piSessionDir?: string }) => {
      const config = resolveConfig(options);
      const scope = await scopedProject(path, config);
      const evidence = await buildProjectEvidence(scope, { config });
      const bundle = buildBoundedBundle(evidence, config.bundleLimits);
      if (options.json) {
        io.stdout(JSON.stringify(bundle));
      } else {
        io.stdout(bundle.content);
      }
      state.exitCode = EXIT_OK;
    });

  const stateCmd = program.command("state").description("PROJECT_STATE.md operations");

  stateCmd.command("inspect").description("inspect State compatibility without writing")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string) => { const config = loadTrackerConfig(); const scope = await scopedProject(path, config); io.stdout(JSON.stringify(await inspectState(scope.root, config.stateFileName))); });

  stateCmd.command("record").description("automatically append progress to an existing design; cannot change definitions")
    .requiredOption("--record <file>", "bounded progress record JSON")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { record: string }) => {
      const config = loadTrackerConfig(); const scope = await scopedProject(path, config);
      const input = readJsonWithSchema(options.record, ProgressAppendSchema);
      const evidence = await buildProjectEvidence(scope, { config });
      try {
        io.stdout(JSON.stringify(await recordProgress(scope.root, input, evidence, config.stateFileName)));
        state.exitCode = EXIT_OK;
      } catch (error) {
        throw new CliError((error as Error).message, error instanceof StateChangedError ? EXIT_CONFLICT : EXIT_INVALID);
      }
    });

  stateCmd.command("migrate").description("emit a v2 proposal without writing State")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string) => {
      const config = loadTrackerConfig();
      const scope = await scopedProject(path, config);
      const parsed = parseProjectState(readFileSync(join(scope.root, config.stateFileName), "utf8"));
      if (!parsed.proposal) throw new CliError("no valid State to migrate", EXIT_INVALID);
      io.stdout(JSON.stringify(parsed.proposal.schemaVersion === 1 ? migrateLegacyState(parsed.proposal) : parsed.proposal, null, 2));
      state.exitCode = EXIT_OK;
    });

  stateCmd
    .command("validate")
    .description("validate a proposal against an evidence bundle")
    .requiredOption("--proposal <file>", "proposal JSON file")
    .option("--evidence <file>", "evidence JSON file (from `scan --json`)")
    .action(async (options: { proposal: string; evidence?: string }) => {
      const proposal = readJsonWithSchema(options.proposal, ProjectStateProposalSchema);
      const refs: { references: Array<{ id: string }> } = options.evidence
        ? readJsonWithSchema(options.evidence, ProjectEvidenceSchema)
        : { references: [] };
      const validation = validateProposalAgainstEvidence(proposal, refs);
      if (!validation.ok) {
        io.stderr(`proposal validation failed:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`);
        state.exitCode = EXIT_INVALID;
        return;
      }
      io.stdout("proposal is valid");
      state.exitCode = EXIT_OK;
    });

  stateCmd
    .command("preview")
    .description("render the proposal into PROJECT_STATE.next.md + unified diff")
    .requiredOption("--proposal <file>", "proposal JSON file")
    .option("--evidence <file>", "evidence JSON file for validation")
    .option("--drop-project-notes", "exclude preserved Project Notes from this preview")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { proposal: string; evidence?: string; dropProjectNotes?: boolean }) => {
      const config = loadTrackerConfig();
      const scope = await scopedProject(path, config);
      const proposal = readJsonWithSchema(options.proposal, ProjectStateProposalSchema);
      let working = proposal;
      if (options.evidence) {
        const evidence = readJsonWithSchema(options.evidence, ProjectEvidenceSchema);
        const validation = validateProposalAgainstEvidence(proposal, evidence);
        if (!validation.ok) {
          throw new CliError(`proposal validation failed: ${validation.errors.join("; ")}`, EXIT_INVALID, {
            errors: validation.errors,
          });
        }
        // Evidence-priority downgrade: P0 conflicts force BLOCKED.
        const downgraded = downgradeReleaseState(proposal.releaseState, evidence.conflicts);
        if (downgraded !== proposal.releaseState) {
          io.stderr(`release state downgraded ${proposal.releaseState} → ${downgraded} due to evidence conflicts`);
          working = { ...proposal, releaseState: downgraded };
        }
      }
      const statePath = join(scope.root, config.stateFileName);
      const parsedExisting = existsSync(statePath) ? parseProjectState(readFileSync(statePath, "utf8")) : null;
      const existing =
        options.dropProjectNotes && parsedExisting
          ? { ...parsedExisting, unknownSections: [] }
          : parsedExisting;
      const diff = await previewStateUpdate(statePath, working, { existing });
      io.stdout(
        JSON.stringify(
          {
            path: statePath,
            expectedHash: diff.expectedHash,
            unifiedDiff: diff.unifiedDiff,
            nextMarkdown: diff.newMarkdown,
          },
          null,
          2,
        ),
      );
      state.exitCode = EXIT_OK;
    });

  stateCmd
    .command("apply")
    .description("atomically write the previewed proposal (hash handshake)")
    .option("--preview <file>", "saved JSON from state preview; applies the exact reviewed markdown")
    .option("--proposal <file>", "legacy proposal JSON (prefer --preview to preserve evidence-driven changes)")
    .option("--hash <hash>", "expectedHash for legacy --proposal ('null' for create)")
    .option("--backup-original", "explicitly retain original as PORJECT_STATE.md.bak before applying")
    .option("--discard-original", "explicitly decline a backup for the reviewed replacement")
    .option("--drop-project-notes", "exclude preserved Project Notes exactly as previewed")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { preview?: string; proposal?: string; hash?: string; dropProjectNotes?: boolean; backupOriginal?: boolean; discardOriginal?: boolean }) => {
      const config = loadTrackerConfig();
      const scope = await scopedProject(path, config);
      const statePath = join(scope.root, config.stateFileName);
      if (options.backupOriginal && options.discardOriginal) throw new CliError("choose backup or discard, not both", EXIT_INVALID);
      const inspection = await inspectState(scope.root, config.stateFileName);
      if (options.hash !== undefined && (options.hash === "null" ? null : options.hash) !== inspection.expectedHash) throw new CliError("PROJECT_STATE.md changed since the preview was generated", EXIT_CONFLICT);
      if (!options.preview && (options.backupOriginal || options.discardOriginal)) throw new CliError("replacement consent requires an exact --preview", EXIT_INVALID);
      if (options.preview) {
        if (options.proposal || options.hash !== undefined || options.dropProjectNotes) {
          throw new CliError("--preview already contains the reviewed content and expectedHash; do not combine it with legacy apply options", EXIT_INVALID);
        }
        const preview = readJsonWithSchema(options.preview, z.object({
          path: z.string(), expectedHash: z.string().nullable(), nextMarkdown: z.string().min(1),
        }));
        if (preview.path !== statePath) throw new CliError("preview belongs to a different project or state file", EXIT_INVALID);
        if (preview.expectedHash !== inspection.expectedHash) throw new CliError("PROJECT_STATE.md changed since the preview was generated", EXIT_CONFLICT);
        const parsed = parseProjectState(preview.nextMarkdown);
        if (!ProjectStateProposalSchema.safeParse(parsed.proposal).success) throw new CliError("preview does not contain a valid project state", EXIT_INVALID);
        if (!options.backupOriginal && !options.discardOriginal && (inspection.requiresReview || await replacementNeedsBackup(scope.root, preview.nextMarkdown, config.stateFileName))) throw new CliError("Structural replacement requires a backup choice: --backup-original or --discard-original", EXIT_INVALID);
        try { await applyStateUpdate(statePath, preview.expectedHash, preview.nextMarkdown, { backupOriginal: options.backupOriginal }); }
        catch (error) {
          if (error instanceof StateChangedError) throw new CliError(error.message, EXIT_CONFLICT, { code: error.code });
          throw error;
        }
        io.stdout(JSON.stringify({ applied: true, path: statePath, hash: await fileHash(statePath) }));
        state.exitCode = EXIT_OK;
        return;
      }
      if (!options.proposal || options.hash === undefined) {
        throw new CliError("supply --preview <file>, or legacy --proposal <file> with --hash", EXIT_INVALID);
      }
      io.stderr("legacy proposal apply re-renders state; use --preview to preserve exactly the reviewed result");
      const proposal = readJsonWithSchema(options.proposal, ProjectStateProposalSchema);
      if (inspection.status === "legacy" && proposal.schemaVersion === 2) throw new CliError("Migration requires an exact preview and backup choice", EXIT_INVALID);
      const parsedExisting = existsSync(statePath) ? parseProjectState(readFileSync(statePath, "utf8")) : null;
      const existing =
        options.dropProjectNotes && parsedExisting
          ? { ...parsedExisting, unknownSections: [] }
          : parsedExisting;
      const markdown = renderProjectState(proposal, existing);
      if (await replacementNeedsBackup(scope.root, markdown, config.stateFileName)) throw new CliError("Structural replacement requires an exact preview and backup choice", EXIT_INVALID);
      try {
        await applyStateUpdate(statePath, options.hash === "null" ? null : options.hash, markdown);
      } catch (error) {
        if (error instanceof StateChangedError) {
          throw new CliError(error.message, EXIT_CONFLICT, { code: error.code });
        }
        throw error;
      }
      // Round-trip confirmation after the atomic write.
      const reparsed = parseProjectState(readFileSync(statePath, "utf8"));
      if (JSON.stringify(reparsed.proposal) !== JSON.stringify(proposal)) {
        io.stderr("warning: written state did not round-trip exactly");
      }
      io.stdout(JSON.stringify({ applied: true, path: statePath, hash: await fileHash(statePath) }));
      state.exitCode = EXIT_OK;
    });

  const checks = program.command("checks").description("propose and explicitly approve project check defaults");
  checks.command("propose").argument("[path]", "project path", process.cwd())
    .action(async (path: string) => { const scope = await scopedProject(path, loadTrackerConfig()); io.stdout(JSON.stringify(await proposeChecks(scope.root))); });
  checks.command("apply").requiredOption("--proposal <file>", "saved defaults proposal").option("--confirm", "user approved these exact commands")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { proposal: string; confirm?: boolean }) => {
      const scope = await scopedProject(path, loadTrackerConfig());
      io.stdout(JSON.stringify(await applyCheckSetup(scope.root, readJsonWithSchema(options.proposal, CheckSetupProposalSchema), !!options.confirm)));
    });

  program
    .command("verify")
    .description("run the project's allowlisted verification commands")
    .option("--json", "output verification records as JSON")
    .argument("[path]", "project path", process.cwd())
    .action(async (path: string, options: { json?: boolean }) => {
      const config = loadTrackerConfig();
      const scope = await scopedProject(path, config);
      state.exitCode = await runVerifyCommand(scope.root, config, io, options);
    });

  program
    .command("dashboard")
    .description("start the loopback dashboard")
    .option("--port <port>", "explicit port (default: random)")
    .option("--reuse", "reuse a running dashboard when present")
    .argument("[paths...]", "project paths", [])
    .action(async (paths: string[], options: { port?: string; reuse?: boolean }) => {
      const config = loadTrackerConfig();
      const targets = paths.length > 0 ? paths : [process.cwd()];
      if (options.reuse) {
        const marker = await readDashboardMarker(config);
        if (marker) {
          const scopes = await Promise.all(targets.map(path => scopedProject(path, config)));
          const result = await inspectDashboardReuse(scopes.map(scope => scope.root), marker);
          if (result.status === "mismatch") throw new CliError(result.message, EXIT_INVALID);
          if (result.status === "matching") {
            io.stdout(JSON.stringify({ url: result.url, reused: true, pid: result.pid }));
            state.exitCode = EXIT_OK;
            return;
          }
        }
      }
      const handle = await startDashboard(targets, {
        port: options.port ? Number(options.port) : undefined,
        config,
      });
      io.stdout(
        JSON.stringify({
          url: handle.url,
          pid: handle.pid,
          port: handle.port,
          stop: `kill ${handle.pid}`,
          markerFile: handle.markerFile,
        }),
      );
      state.exitCode = EXIT_OK;
      // Keep the dashboard process alive until killed.
      await new Promise<never>(() => {});
    });

  async function run(argv: string[]): Promise<number> {
    state.exitCode = EXIT_OK;
    try {
      program.exitOverride();
      program.configureOutput({
        writeOut: (line) => io.stdout(line.replace(/\n$/, "")),
        writeErr: (line) => io.stderr(line.replace(/\n$/, "")),
      });
      await program.parseAsync(argv, { from: "user" });
      return state.exitCode;
    } catch (error) {
      if (error instanceof CliError) {
        io.stderr(error.message);
        if (error.payload !== undefined) {
          io.stderr(JSON.stringify(error.payload));
        }
        return error.exitCode;
      }
      const err = error as { code?: string; message?: string };
      if (
        err?.code === "commander.helpDisplayed" ||
        err?.code === "commander.version" ||
        err?.code === "commander.help"
      ) {
        return EXIT_OK;
      }
      io.stderr(err?.message ?? String(error));
      return EXIT_ERROR;
    }
  }

  return { program, run };
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const { run } = buildCli(io);
  return run(argv);
}

const isDirectRun = process.argv[1]?.endsWith("cli.js") ?? false;
if (isDirectRun) {
  void runCli(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exit(code);
  });
}
