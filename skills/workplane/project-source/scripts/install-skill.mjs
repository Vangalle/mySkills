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
import { fileURLToPath } from "node:url";

const installer = fileURLToPath(import.meta.url);
const root = resolve(dirname(installer), "..");
const NAME = "workplane";
const MARKER = ".workplane-source.json";
const CLI_MARKER = ".workplane-cli-source.json";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

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
    uninstall: false,
  };
  const values = { "--skills-dir": "skillsDir", "--bin-dir": "binDir" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--uninstall") options.uninstall = true;
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      options[values[arg]] = resolve(value);
    } else throw new Error(`unknown option: ${arg}`);
  }
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
    }
    // Validate the exact filesystem objects that will be purged, not paths that
    // could have been replaced after the initial ownership check.
    await validate();
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
  const action = options.uninstall ? "uninstall" : "overwrite";

  await requireOwnedDirectory(target, source, action);
  await requireOwnedCli(cli, cliMarker, source, action);

  if (options.uninstall) {
    const targetInfo = await stat(target);
    const cliInfo = await stat(cli);
    const cliMarkerInfo = await stat(cliMarker);
    if (!targetInfo && !cliInfo) {
      throw new Error(`refusing to uninstall ${target}: no owned installation found`);
    }
    const transaction = randomUUID();
    const targetBackup = `${target}.uninstall-${transaction}`;
    const cliBackup = `${cli}.uninstall-${transaction}`;
    const cliMarkerBackup = `${cliMarker}.uninstall-${transaction}`;
    const entries = [
      targetInfo && { path: target, backup: targetBackup, recursive: true },
      cliInfo && { path: cli, backup: cliBackup, recursive: false },
      cliMarkerInfo && { path: cliMarker, backup: cliMarkerBackup, recursive: false },
    ].filter(Boolean);
    const cleanupFailures = await transactionalRemove(entries, { rename, rm }, async () => {
      if (targetInfo) await requireOwnedDirectory(targetBackup, source, action);
      if (cliInfo) await requireOwnedCli(cliBackup, cliMarkerBackup, source, action);
    });
    console.log(`uninstalled ${NAME} → ${target}`);
    for (const failure of cleanupFailures) console.warn(`uninstall backup requires cleanup: ${failure}`);
    return;
  }

  if (!(await stat(join(source, "SKILL.md")))?.isFile()) throw new Error(`skill source not found: ${source}`);

  const transaction = randomUUID();
  const stageSkill = `${target}.stage-${transaction}`;
  const stageCli = `${cli}.stage-${transaction}`;
  const backupSkill = `${target}.backup-${transaction}`;
  const backupCli = `${cli}.backup-${transaction}`;
  const before = await snapshot(target);
  const cliBefore = await snapshot(cli);
  let committedSkill = false;
  let committedCli = false;
  try {
    await mkdir(dirname(target), { recursive: true });
    await mkdir(dirname(cli), { recursive: true });
    await cp(source, stageSkill, { recursive: true });
    await writeFile(
      join(stageSkill, MARKER),
      `${JSON.stringify({ source, installer, cli, treeSha256: await treeDigest(stageSkill), installedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    const launcher = `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(join(root, "src", "cli.mjs"))} "$@"\n`;
    await writeFile(stageCli, launcher);
    await chmod(stageCli, 0o755);

    // Re-check ownership immediately before swapping so a concurrent edit is not clobbered.
    await requireOwnedDirectory(target, source, action);
    await requireOwnedCli(cli, cliMarker, source, action);
    if (before !== (await snapshot(target))) throw new Error(`installation changed while staging: ${target}`);
    if (cliBefore !== (await snapshot(cli))) throw new Error(`installation changed while staging: ${cli}`);

    if (before !== null) await rename(target, backupSkill);
    await rename(stageSkill, target);
    committedSkill = true;
    if (cliBefore !== null) await rename(cli, backupCli);
    await rename(stageCli, cli);
    committedCli = true;
    await writeFile(cliMarker, `${JSON.stringify({ source, sha256: digest(launcher) }, null, 2)}\n`);
  } catch (error) {
    const failures = [];
    try {
      if (committedSkill) await rm(target, { recursive: true, force: true });
      if (await stat(backupSkill)) await rename(backupSkill, target);
      if (committedCli) await rm(cli, { force: true });
      if (await stat(backupCli)) await rename(backupCli, cli);
    } catch (rollbackError) {
      failures.push(rollbackError.message);
    }
    if (failures.length) throw new Error(`${error.message}; rollback requires inspection: ${failures.join("; ")}`);
    throw error;
  } finally {
    await rm(stageSkill, { recursive: true, force: true });
    await rm(stageCli, { force: true });
  }
  await rm(backupSkill, { recursive: true, force: true });
  await rm(backupCli, { force: true });

  console.log(`installed ${NAME} → ${target}`);
  console.log(`local CLI: ${cli}`);
  console.log(`Pi exposes /skill:${NAME}; run /reload or a new session to load it.`);
}

async function invokedDirectly() {
  if (!process.argv[1]) return false;
  try { return (await realpath(resolve(process.argv[1]))) === (await realpath(installer)); }
  catch { return false; }
}

if (await invokedDirectly()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
