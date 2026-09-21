#!/usr/bin/env node
/** Local, same-source-only skill/CLI installer. CodeGraph is an explicit opt-in. */
import { cp, mkdir, readFile, rm, writeFile, lstat, rename, chmod, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { decideWorkplaneInstall, resolveWorkplaneOffer } from "./workplane-install-choice.mjs";

const installer = fileURLToPath(import.meta.url);
const root = resolve(dirname(installer), "..");
const MARKER = ".project-tracker-source.json";
const CLI_MARKER = ".project-tracker-cli-source.json";
const RUNTIME_MARKER = ".project-tracker-runtime-source.json";
const EXTENSION_MARKER = ".project-tracker-extension-source.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
let interruptedBy = null;
function throwIfInterrupted() {
  if (interruptedBy) throw new Error(`installation interrupted by ${interruptedBy}`);
}

async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function json(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}
function parseArgs(args) {
  const options = { skill: "project-tracker", skillsDir: join(homedir(), ".pi", "agent", "skills"), binDir: join(homedir(), ".local", "bin"), runtimeDir: resolve(process.env.PROJECT_TRACKER_CODEGRAPH_DIR || join(homedir(), ".local", "share", "project-tracker", "codegraph")), uninstall: false, confirmCodegraph: false, confirmWorkplane: false, withoutWorkplane: false, workplaneSource: null };
  const values = { "--skill": "skill", "--skills-dir": "skillsDir", "--bin-dir": "binDir", "--runtime-dir": "runtimeDir", "--extensions-dir": "extensionsDir" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--uninstall") options.uninstall = true;
    else if (arg === "--confirm-codegraph") options.confirmCodegraph = true;
    else if (arg === "--confirm-workplane") options.confirmWorkplane = true;
    else if (arg === "--without-workplane") options.withoutWorkplane = true;
    else if (arg === "--workplane-source") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error("missing value for --workplane-source");
      options.workplaneSource = resolve(value);
    }
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      options[values[arg]] = arg === "--skill" ? value : resolve(value);
    } else throw new Error(`unknown option: ${arg}`);
  }
  options.extensionsDir ??= join(dirname(options.skillsDir), "extensions");
  if (!["project-tracker", "codegraph"].includes(options.skill)) throw new Error("--skill must be project-tracker or codegraph");
  if (options.skill === "codegraph" && !options.uninstall && !options.confirmCodegraph) throw new Error("CodeGraph installation requires separate explicit user approval; only then pass --confirm-codegraph. Tracker works without it.");
  return options;
}
async function treeDigest(directory, prefix = "") {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    if (!prefix && name === MARKER) continue;
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`refusing modified skill entry: ${path}`);
    files.push(info.isDirectory() ? [prefix + name + "/", await treeDigest(path, prefix + name + "/")] : [prefix + name, digest(await readFile(path))]);
  }
  return digest(JSON.stringify(files));
}
async function requireOwnedDirectory(target, markerName, source, action) {
  const info = await stat(target);
  if (!info) return;
  const marker = await json(join(target, markerName));
  if (!info.isDirectory() || info.isSymbolicLink() || marker?.source !== source) throw new Error(`refusing to ${action} ${target}: foreign or unmarked directory`);
  if (marker.treeSha256 && marker.treeSha256 !== await treeDigest(target)) throw new Error(`refusing to ${action} ${target}: skill files changed since installation`);
}
async function requireOwnedCli(target, markerPath, source, action) {
  const info = await stat(target);
  const markerInfo = await stat(markerPath);
  if (!info && !markerInfo) return;
  const marker = await json(markerPath);
  if (!info?.isFile() || info.isSymbolicLink() || !markerInfo?.isFile() || markerInfo.isSymbolicLink() || marker?.source !== source || marker?.sha256 !== digest(await readFile(target))) throw new Error(`refusing to ${action} ${target}: foreign, changed or unmarked command`);
}
async function requireOwnedExtension(target, source, action) {
  await requireOwnedDirectory(target, EXTENSION_MARKER, source, action);
  if (!await stat(target)) return;
  await requireOwnedCli(join(target, "index.ts"), join(target, EXTENSION_MARKER), source, action);
  if ((await readdir(target)).some((name) => !["index.ts", EXTENSION_MARKER].includes(name))) throw new Error(`refusing to ${action} ${target}: extension contains user files`);
}
async function snapshot(path) {
  const info = await stat(path);
  return info ? `${info.dev}:${info.ino}:${info.mtimeMs}:${info.size}` : null;
}
async function runNpm(cwd) {  await new Promise((resolveRun, reject) => {
    const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolveRun() : reject(new Error(`CodeGraph npm ci failed (${signal || code}); existing installation preserved`)));
  });
  const pkg = await json(join(cwd, "node_modules", "@colbymchenry", "codegraph", "package.json"));
  if (pkg?.version !== "1.6.0") throw new Error("CodeGraph runtime validation failed: expected version 1.6.0");
  const platformLibrary = join(cwd, "node_modules", "@colbymchenry", `codegraph-${process.platform}-${process.arch}`, "lib", "dist", "index.js");
  if (!(await stat(platformLibrary))?.isFile()) throw new Error("CodeGraph runtime validation failed: native platform library missing");
  const sdk = createRequire(import.meta.url)(join(cwd, "node_modules", "@colbymchenry", "codegraph"));
  if (typeof sdk.getDatabasePath !== "function" || typeof sdk.CodeGraph?.open !== "function" || typeof sdk.CodeGraph?.init !== "function") throw new Error("CodeGraph runtime validation failed: incompatible SDK");
}
async function main() {
  const options = parseArgs(process.argv.slice(2));  const source = join(root, "skill", options.skill);
  const target = join(options.skillsDir, options.skill);
  const cli = join(options.binDir, "project-tracker");
  const cliMarker = join(options.binDir, CLI_MARKER);
  const extension = join(options.extensionsDir, "project-tracker");
  const action = options.uninstall ? "uninstall" : "overwrite";
  const addon = options.skill === "codegraph";
  const entries = [{ target }];
  if (addon) entries.push({ target: options.runtimeDir });
  else entries.push({ target: cli }, { target: cliMarker }, { target: extension });
  for (const entry of entries) {
    for (const other of entries) {
      if (entry !== other && (entry.target === other.target || entry.target.startsWith(other.target + "/"))) throw new Error("installation destinations must not overlap");
    }
  }
  async function checkOwnership() {
    await requireOwnedDirectory(target, MARKER, source, action);
    if (addon) await requireOwnedDirectory(options.runtimeDir, RUNTIME_MARKER, source, action);
    else {
      await requireOwnedCli(cli, cliMarker, source, action);
      await requireOwnedExtension(extension, source, action);
    }
  }
  await checkOwnership();
  for (const entry of entries) entry.before = await snapshot(entry.target);
  if (options.uninstall && entries.every((entry) => entry.before === null)) throw new Error(`refusing to uninstall ${target}: no owned installation found`);
  if (!options.uninstall) {
    if (!(await stat(join(source, "SKILL.md")))?.isFile()) throw new Error(`skill source not found: ${source}`);
    if (!addon) for (const file of ["cli.js", "pi/extension.js"]) {
      if (!(await stat(join(root, "dist", file)))?.isFile()) throw new Error("CLI/extension build missing: run npm run build in the Tracker source checkout before installing");
    }
  }
  const transaction = randomUUID();
  try {
    if (!options.uninstall) {
      for (const entry of entries) {
        await mkdir(dirname(entry.target), { recursive: true });
        entry.stage = `${entry.target}.stage-${transaction}`;
      }
      await cp(source, entries[0].stage, { recursive: true });
      await writeFile(join(entries[0].stage, MARKER), JSON.stringify({ source, installer, cli: addon ? undefined : cli, treeSha256: await treeDigest(entries[0].stage), installedAt: new Date().toISOString() }, null, 2) + "\n");
      if (addon) {
        await mkdir(entries[1].stage);
        for (const file of ["package.json", "package-lock.json"]) await cp(join(source, "runtime", file), join(entries[1].stage, file));
        await runNpm(entries[1].stage);
        await writeFile(join(entries[1].stage, RUNTIME_MARKER), JSON.stringify({ source, installedAt: new Date().toISOString(), version: "1.6.0" }, null, 2) + "\n");
      } else {
        const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(root, "dist", "cli.js"))} "$@"\n`;
        await writeFile(entries[1].stage, launcher);
        await chmod(entries[1].stage, 0o755);
        await writeFile(entries[2].stage, JSON.stringify({ source, sha256: digest(launcher) }, null, 2) + "\n");
        const adapter = `// Installed by Project Tracker; local source, no network dependencies.\nexport default async function projectTracker(pi) {\n  const { installTrackerExtension } = await import(${JSON.stringify(pathToFileURL(join(root, "dist/pi/extension.js")).href)});\n  installTrackerExtension(pi, ${JSON.stringify({ node: process.execPath, cli: join(root, "dist/cli.js"), skillFile: join(target, "SKILL.md") })});\n}\n`;
        await mkdir(entries[3].stage);
        await writeFile(join(entries[3].stage, "index.ts"), adapter);
        await writeFile(join(entries[3].stage, EXTENSION_MARKER), JSON.stringify({ source, sha256: digest(adapter) }, null, 2) + "\n");
      }
    }
    throwIfInterrupted();
    await checkOwnership();
    for (const entry of entries) if (entry.before !== await snapshot(entry.target)) throw new Error(`installation changed while staging: ${entry.target}; retry after inspecting it`);
    for (const entry of entries) {
      if (entry.before !== null) {
        entry.backup = `${entry.target}.backup-${transaction}`;
        await rename(entry.target, entry.backup);
        throwIfInterrupted();
      }
      if (entry.stage) {
        await rename(entry.stage, entry.target);
        entry.committed = true;
        throwIfInterrupted();
      }
    }
  } catch (error) {
    const failures = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.committed) await rm(entry.target, { recursive: true, force: true });
        if (entry.backup && await stat(entry.backup)) await rename(entry.backup, entry.target);
      } catch (rollbackError) { failures.push(`${entry.target}: ${rollbackError.message}`); }
    }
    if (failures.length) throw new Error(`${error.message}; rollback requires inspection: ${failures.join("; ")}`);
    throw error;
  } finally {
    for (const entry of entries) if (entry.stage) await rm(entry.stage, { recursive: true, force: true });
  }
  for (const entry of entries) if (entry.backup) await rm(entry.backup, { recursive: true, force: true });
  console.log(`${options.uninstall ? "uninstalled" : "installed"} ${options.skill} → ${target}`);
  if (addon) console.log(`CodeGraph runtime: ${options.runtimeDir}`);
  else {
    console.log(`local CLI: ${cli}`);
    console.log(`Pi extension: ${extension}`);
    if (!options.uninstall) console.log("请在 Pi 中 /reload 或启动新会话以加载扫描入口；仅加载 skill 文本不提供执行门槛。");
  }
  if (!options.uninstall) console.log(`Pi exposes /skill:${options.skill}`);

  if (!options.uninstall && options.workplaneSource) {
    const offer = await resolveWorkplaneOffer(options.workplaneSource);
    const decision = await decideWorkplaneInstall({
      offer,
      confirm: options.confirmWorkplane,
      skip: options.withoutWorkplane,
      interactive: process.stdin.isTTY === true,
      ask: promptWorkplane,
    });
    if (decision.install && offer) {
      try {
        await runWorkplaneInstaller(offer.installer, options.skillsDir, options.binDir);
        console.log(`Workplane installed from ${offer.source} (version ${offer.version}).`);
      } catch (error) {
        console.log("Tracker installed. Workplane installation failed; Project Tracker remains fully usable without it.");
        console.error(`Workplane installation failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
    } else if (decision.reason === "declined") {
      console.log("Skipping Workplane; installing Project Tracker only.");
    } else if (decision.reason === "non_interactive") {
      console.log("Non-interactive install: Project Tracker only. Pass --confirm-workplane to add Workplane.");
    }
  }
  throwIfInterrupted();
}

function runWorkplaneInstaller(installer, skillsDir, binDir) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [installer, "--skills-dir", skillsDir, "--bin-dir", binDir], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => (code === 0 ? resolveRun() : reject(new Error(`Workplane installer exited with ${signal ?? code}`))));
  });
}

async function promptWorkplane(offer) {
  const label = offer ? `${offer.source} (version ${offer.version})` : "the Workplane source";
  process.stdout.write(`Install Workplane from ${label}? [y/N] `);
  return new Promise((resolveRead) => {
    let data = "";
    const onData = (chunk) => {
      data += String(chunk);
      if (data.includes("\n")) {
        process.stdin.off("data", onData);
        resolveRead(data.trim());
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
}
const onSigint = () => { interruptedBy = "SIGINT"; };
const onSigterm = () => { interruptedBy = "SIGTERM"; };
process.on("SIGINT", onSigint);
process.on("SIGTERM", onSigterm);
main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}).finally(() => {
  process.off("SIGINT", onSigint);
  process.off("SIGTERM", onSigterm);
});
