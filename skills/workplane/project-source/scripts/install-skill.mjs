#!/usr/bin/env node
/**
 * Independent Workplane installer.
 *
 * Installs only Workplane's own skill and launcher. It never installs, edits or
 * removes a Project Tracker extension; the two components are owned and removed
 * separately.
 */
import { chmod, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const installer = fileURLToPath(import.meta.url);
const root = resolve(dirname(installer), "..");
const NAME = "workplane";
const MARKER = ".workplane-source.json";
const CLI_MARKER = ".workplane-cli-source.json";
const EXTENSION_MARKER = ".workplane-extension-source.json";
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
  const options = {
    skillsDir: join(homedir(), ".pi", "agent", "skills"),
    binDir: join(homedir(), ".local", "bin"),
    extensionsDir: null,
    uninstall: false,
  };
  const values = { "--skills-dir": "skillsDir", "--bin-dir": "binDir", "--extensions-dir": "extensionsDir" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--uninstall") options.uninstall = true;
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      options[values[arg]] = resolve(value);
    } else throw new Error(`unknown option: ${arg}`);
  }
  options.extensionsDir ??= join(dirname(options.skillsDir), "extensions");
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
async function requireOwnedDirectory(target, source, action) {
  const info = await stat(target);
  if (!info) return;
  const marker = await json(join(target, MARKER));
  if (!info.isDirectory() || info.isSymbolicLink() || marker?.source !== source) {
    throw new Error(`refusing to ${action} ${target}: foreign or unmarked directory`);
  }
  if (marker.treeSha256 && marker.treeSha256 !== (await treeDigest(target))) {
    throw new Error(`refusing to ${action} ${target}: skill files changed since installation`);
  }
}
async function requireOwnedCli(target, markerPath, source, action) {
  const info = await stat(target);
  const markerInfo = await stat(markerPath);
  if (!info && !markerInfo) return;
  const marker = await json(markerPath);
  if (
    !info?.isFile() ||
    info.isSymbolicLink() ||
    !markerInfo?.isFile() ||
    markerInfo.isSymbolicLink() ||
    marker?.source !== source ||
    marker?.sha256 !== digest(await readFile(target))
  ) {
    throw new Error(`refusing to ${action} ${target}: foreign, changed or unmarked command`);
  }
}
async function requireOwnedExtension(target, source, action) {
  const info = await stat(target);
  if (!info) return;
  const markerPath = join(target, EXTENSION_MARKER);
  const markerInfo = await stat(markerPath);
  const adapter = join(target, "index.ts");
  const adapterInfo = await stat(adapter);
  const marker = await json(markerPath);
  if (
    !info.isDirectory() || info.isSymbolicLink() ||
    !markerInfo?.isFile() || markerInfo.isSymbolicLink() ||
    !adapterInfo?.isFile() || adapterInfo.isSymbolicLink() ||
    marker?.source !== source || marker?.sha256 !== digest(await readFile(adapter))
  ) {
    throw new Error(`refusing to ${action} ${target}: foreign, changed or unmarked extension`);
  }
  const names = (await readdir(target)).sort();
  if (names.length !== 2 || names[0] !== EXTENSION_MARKER || names[1] !== "index.ts") {
    throw new Error(`refusing to ${action} ${target}: extension contains user files`);
  }
}
async function snapshot(path) {
  const info = await stat(path);
  return info ? `${info.dev}:${info.ino}:${info.mtimeMs}:${info.size}` : null;
}

export async function transactionalRemove(entries, operations = { rename, rm }, validate = async () => {}) {
  const moved = [];
  try {
    for (const entry of entries) {
      await operations.rename(entry.path, entry.backup);
      moved.push(entry);
      if (operations.check) await operations.check();
    }
    // Validate the exact filesystem objects that will be purged, not paths that
    // could have been replaced after the initial ownership check.
    await validate();
    if (operations.check) await operations.check();
  } catch (error) {
    const failures = [];
    for (const entry of moved.reverse()) {
      try { await operations.rename(entry.backup, entry.path); }
      catch (rollbackError) { failures.push(rollbackError.message); }
    }
    if (failures.length) {
      throw new Error(`${error.message}; uninstall rollback requires inspection: ${failures.join("; ")}`);
    }
    throw error;
  }

  // Staging is the uninstall commit. A failed backup purge must not report that
  // the live installation was partially restored; retain the backup for cleanup.
  const cleanupFailures = [];
  for (const entry of moved) {
    try { await operations.rm(entry.backup, { recursive: entry.recursive, force: true }); }
    catch (error) { cleanupFailures.push(`${entry.backup}: ${error.message}`); }
  }
  return cleanupFailures;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = join(root, "skill", NAME);
  const target = join(options.skillsDir, NAME);
  const cli = join(options.binDir, NAME);
  const cliMarker = join(options.binDir, CLI_MARKER);
  const extension = join(options.extensionsDir, NAME);
  const action = options.uninstall ? "uninstall" : "overwrite";
  const destinations = [target, cli, cliMarker, extension];
  for (let i = 0; i < destinations.length; i++) {
    for (let j = i + 1; j < destinations.length; j++) {
      const entry = destinations[i];
      const other = destinations[j];
      if (entry === other || entry.startsWith(`${other}/`) || other.startsWith(`${entry}/`)) {
        throw new Error("installation destinations must not overlap");
      }
    }
  }

  async function checkOwnership() {
    await requireOwnedDirectory(target, source, action);
    await requireOwnedCli(cli, cliMarker, source, action);
    await requireOwnedExtension(extension, source, action);
  }
  await checkOwnership();

  if (options.uninstall) {
    const [targetInfo, cliInfo, cliMarkerInfo, extensionInfo] = await Promise.all(
      [target, cli, cliMarker, extension].map(stat),
    );
    if (!targetInfo && !cliInfo && !extensionInfo) {
      throw new Error(`refusing to uninstall ${target}: no owned installation found`);
    }
    const transaction = randomUUID();
    const entries = [
      targetInfo && { path: target, backup: `${target}.uninstall-${transaction}`, recursive: true },
      cliInfo && { path: cli, backup: `${cli}.uninstall-${transaction}`, recursive: false },
      cliMarkerInfo && { path: cliMarker, backup: `${cliMarker}.uninstall-${transaction}`, recursive: false },
      extensionInfo && { path: extension, backup: `${extension}.uninstall-${transaction}`, recursive: true },
    ].filter(Boolean);
    const cleanupFailures = await transactionalRemove(entries, { rename, rm, check: throwIfInterrupted }, async () => {
      if (targetInfo) await requireOwnedDirectory(`${target}.uninstall-${transaction}`, source, action);
      if (cliInfo) await requireOwnedCli(`${cli}.uninstall-${transaction}`, `${cliMarker}.uninstall-${transaction}`, source, action);
      if (extensionInfo) await requireOwnedExtension(`${extension}.uninstall-${transaction}`, source, action);
    });
    console.log(`uninstalled ${NAME} → ${target}`);
    for (const failure of cleanupFailures) console.warn(`uninstall backup requires cleanup: ${failure}`);
    return;
  }

  if (!(await stat(join(source, "SKILL.md")))?.isFile()) throw new Error(`skill source not found: ${source}`);
  if (!(await stat(join(root, "src", "pi", "extension.mjs")))?.isFile()) throw new Error("Pi extension source missing");

  const transaction = randomUUID();
  const entries = [
    { target, recursive: true, kind: "skill" },
    { target: cli, recursive: false, kind: "cli" },
    { target: cliMarker, recursive: false, kind: "cli-marker" },
    { target: extension, recursive: true, kind: "extension" },
  ].map((entry) => ({
    ...entry,
    before: null,
    stage: `${entry.target}.stage-${transaction}`,
    backup: `${entry.target}.backup-${transaction}`,
    committed: false,
  }));
  for (const entry of entries) entry.before = await snapshot(entry.target);

  const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(root, "src", "cli.mjs"))} "$@"\n`;
  const adapter = `// Installed by Workplane; local source, no network dependencies.\nexport default async function workplane(pi) {\n  const { installWorkplaneExtension } = await import(${JSON.stringify(pathToFileURL(join(root, "src", "pi", "extension.mjs")).href)});\n  installWorkplaneExtension(pi, ${JSON.stringify({ node: process.execPath, cli: join(root, "src", "cli.mjs"), skillFile: join(target, "SKILL.md") })});\n}\n`;

  try {
    for (const entry of entries) await mkdir(dirname(entry.target), { recursive: true });
    const skillEntry = entries.find((entry) => entry.kind === "skill");
    await cp(source, skillEntry.stage, { recursive: true });
    await writeFile(
      join(skillEntry.stage, MARKER),
      `${JSON.stringify({ source, installer, cli, extension, treeSha256: await treeDigest(skillEntry.stage), installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    await writeFile(entries.find((entry) => entry.kind === "cli").stage, launcher);
    await chmod(entries.find((entry) => entry.kind === "cli").stage, 0o755);
    await writeFile(
      entries.find((entry) => entry.kind === "cli-marker").stage,
      `${JSON.stringify({ source, sha256: digest(launcher) }, null, 2)}\n`,
    );
    const extensionEntry = entries.find((entry) => entry.kind === "extension");
    await mkdir(extensionEntry.stage);
    await writeFile(join(extensionEntry.stage, "index.ts"), adapter);
    await writeFile(
      join(extensionEntry.stage, EXTENSION_MARKER),
      `${JSON.stringify({ source, sha256: digest(adapter) }, null, 2)}\n`,
    );

    throwIfInterrupted();
    await checkOwnership();
    for (const entry of entries) {
      if (entry.before !== (await snapshot(entry.target))) {
        throw new Error(`installation changed while staging: ${entry.target}`);
      }
    }
    for (const entry of entries) {
      if (entry.before !== null) {
        await rename(entry.target, entry.backup);
        throwIfInterrupted();
      }
      await rename(entry.stage, entry.target);
      entry.committed = true;
      throwIfInterrupted();
    }
  } catch (error) {
    const failures = [];
    for (const entry of [...entries].reverse()) {
      try {
        if (entry.committed) await rm(entry.target, { recursive: entry.recursive, force: true });
        if (await stat(entry.backup)) await rename(entry.backup, entry.target);
      } catch (rollbackError) { failures.push(`${entry.target}: ${rollbackError.message}`); }
    }
    if (failures.length) throw new Error(`${error.message}; rollback requires inspection: ${failures.join("; ")}`);
    throw error;
  } finally {
    for (const entry of entries) await rm(entry.stage, { recursive: entry.recursive, force: true });
  }
  for (const entry of entries) await rm(entry.backup, { recursive: entry.recursive, force: true });

  console.log(`installed ${NAME} → ${target}`);
  console.log(`local CLI: ${cli}`);
  console.log(`Pi extension: ${extension}`);
  console.log(`Pi exposes /skill:${NAME}; run /reload or a new session to load it.`);
}

async function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    const entry = process.argv[1].startsWith("file:") ? fileURLToPath(process.argv[1]) : resolve(process.argv[1]);
    return (await realpath(entry)) === (await realpath(installer));
  }
  catch { return false; }
}

if (await invokedDirectly()) {
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
}
