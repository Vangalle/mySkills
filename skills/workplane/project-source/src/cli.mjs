#!/usr/bin/env node
/**
 * Workplane CLI — command boundary.
 *
 *   workplane plugin                                    machine JSON protocol
 *   workplane validate <WORKPLANE.json> --snapshot <f>  human diagnostics
 *   workplane render <WORKPLANE.json> --snapshot <f> --out <dir>
 *
 * `plugin` reads exactly one request from stdin and writes exactly one
 * response to stdout. Diagnostics never contaminate that stream.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PluginRequestSchema, PROTOCOL_VERSION } from "./contracts.mjs";
import { buildPlane } from "./build.mjs";
import { inspectProject } from "./inspect.mjs";
import { renderHtml, renderMermaid } from "./render.mjs";

const MAX_STDIN = 10 * 1024 * 1024;

const USAGE = `workplane — Work Unit graph and Project Tracker bridge

Usage:
  workplane plugin
  workplane inspect [project-root] --request-id <uuid>
  workplane validate <WORKPLANE.json> --snapshot <snapshot.json>
  workplane render <WORKPLANE.json> --snapshot <snapshot.json> --out <dir>
  workplane --help

Commands:
  plugin    Read one versioned JSON request on stdin, write one JSON response.
  inspect   Read WORKPLANE.json state and emit a bounded project receipt; writes nothing.
  validate  Check a definition against a Tracker snapshot; writes nothing.
  render    Write workplane.json, workplane.mmd and workplane.html to --out.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      flags[name] = value;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function emitInvalid(errors) {
  process.stdout.write(`${JSON.stringify({ protocolVersion: PROTOCOL_VERSION, status: "invalid", errors })}\n`);
  process.exitCode = 3;
}

function zodErrors(result) {
  return result.error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

function readStdin(limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    process.stdin.on("data", (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > limit) {
        settled = true;
        reject(new Error(`request exceeds the ${Math.floor(limit / (1024 * 1024))} MiB stdin limit`));
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    process.stdin.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function loadInputs(flags, positional) {
  const definitionFile = positional[0];
  const snapshotFile = flags.snapshot;
  if (!definitionFile || !snapshotFile || typeof snapshotFile !== "string") {
    throw new Error("需要 <WORKPLANE.json> 和 --snapshot <snapshot.json>");
  }
  const definition = JSON.parse(await readFile(definitionFile, "utf8"));
  const tracker = JSON.parse(await readFile(snapshotFile, "utf8"));
  return { definition, tracker };
}

async function cmdInspect(flags, positional) {
  const requestId = flags["request-id"];
  if (!requestId || typeof requestId !== "string") {
    throw new Error("inspect requires --request-id <uuid>");
  }
  const receipt = await inspectProject(positional[0] ?? process.cwd(), { requestId });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exitCode = 0;
}

async function cmdPlugin() {
  let raw;
  try {
    raw = await readStdin(MAX_STDIN);
  } catch (error) {
    if (process.stdin.destroy) process.stdin.destroy();
    return emitInvalid([{ path: "", message: error.message }]);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return emitInvalid([{ path: "", message: `invalid JSON request: ${error.message}` }]);
  }
  const checked = PluginRequestSchema.safeParse(parsed);
  if (!checked.success) return emitInvalid(zodErrors(checked));

  const document = buildPlane(checked.data.definition, checked.data.tracker, { now: new Date().toISOString() });
  if (!document.receipt.pass) return emitInvalid(document.receipt.issues);

  const response = {
    protocolVersion: PROTOCOL_VERSION,
    status: "ok",
    document,
    html: renderHtml(document),
    mermaid: renderMermaid(document),
  };
  process.stdout.write(`${JSON.stringify(response)}\n`);
  process.exitCode = 0;
}

async function buildFromFiles(flags, positional) {
  const { definition, tracker } = await loadInputs(flags, positional);
  const request = PluginRequestSchema.safeParse({
    protocolVersion: PROTOCOL_VERSION,
    definition,
    tracker,
  });
  if (!request.success) return { invalid: zodErrors(request), document: null };
  const document = buildPlane(request.data.definition, request.data.tracker, { now: new Date().toISOString() });
  if (!document.receipt.pass) return { invalid: document.receipt.issues, document };
  return { invalid: null, document };
}

async function cmdValidate(flags, positional) {
  let result;
  try {
    result = await buildFromFiles(flags, positional);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.invalid) {
    for (const issue of result.invalid) process.stderr.write(`${issue.path}: ${issue.message}\n`);
    process.stdout.write("FAIL\n");
    process.exitCode = 3;
    return;
  }
  const document = result.document;
  process.stdout.write(
    `PASS 通过：${document.coverage.units} 个工作单元，${document.coverage.delivered} 个已验证。\n`,
  );
  process.exitCode = 0;
}

async function cmdRender(flags, positional) {
  const outDir = flags.out;
  if (!outDir || typeof outDir !== "string") {
    process.stderr.write("render 需要 --out <dir>\n");
    process.exitCode = 1;
    return;
  }
  let result;
  try {
    result = await buildFromFiles(flags, positional);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (result.invalid) {
    for (const issue of result.invalid) process.stderr.write(`${issue.path}: ${issue.message}\n`);
    process.stdout.write("FAIL\n");
    process.exitCode = 3;
    return;
  }
  const document = result.document;
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "workplane.json"), `${JSON.stringify(document, null, 2)}\n`);
  await writeFile(join(outDir, "workplane.mmd"), renderMermaid(document));
  await writeFile(join(outDir, "workplane.html"), renderHtml(document));
  process.stdout.write(`已写入 ${outDir}/workplane.html、workplane.json、workplane.mmd\n`);
  process.exitCode = 0;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE);
    process.exitCode = 0;
    return;
  }
  if (command === "plugin") return cmdPlugin();
  if (command === "inspect") return cmdInspect(flags, positional);
  if (command === "validate") return cmdValidate(flags, positional);
  if (command === "render") return cmdRender(flags, positional);
  process.stderr.write(`unknown command: ${command}\n${USAGE}`);
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
