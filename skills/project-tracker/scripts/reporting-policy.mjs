#!/usr/bin/env node
// The calling agent decides which user-facing reports qualify and supplies the
// skill path from its own available-skills list. No cross-host discovery occurs.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

function metadataEntry(path, kind) {
  let entry;
  try { entry = lstatSync(path); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (entry.isSymbolicLink()) throw new Error(`Refusing metadata symlink: ${path}`);
  if (!(kind === "directory" ? entry.isDirectory() : entry.isFile())) {
    throw new Error(`Expected metadata ${kind}: ${path}`);
  }
  return true;
}

function availableSkill(path) {
  if (!path) return null;
  const absolute = resolve(path);
  let body;
  try {
    if (!statSync(absolute).isFile()) return null;
    body = readFileSync(absolute, "utf8");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
  const frontmatter = body.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const names = frontmatter?.split(/\r?\n/).filter((line) => /^name\s*:/.test(line)) ?? [];
  return names.length === 1 && /^name\s*:\s*(?:explain-with-diagrams|"explain-with-diagrams"|'explain-with-diagrams')\s*(?:#.*)?$/.test(names[0])
    ? absolute : null;
}

function readState(file) {
  if (!metadataEntry(file, "file")) return { version: 1, missingReportCount: 0, lastReportId: null };
  let state;
  try { state = JSON.parse(readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Invalid reporting state at ${file}: ${error.message}`); }
  if (!state || state.version !== 1 || !Number.isSafeInteger(state.missingReportCount)
    || state.missingReportCount < 1 || typeof state.lastReportId !== "string" || !state.lastReportId.trim()) {
    throw new Error(`Invalid reporting state at ${file}; expected version 1, a positive missingReportCount, and lastReportId. Preserve and repair this file before retrying.`);
  }
  return state;
}

function main() {
  const { values } = parseArgs({ options: {
    project: { type: "string" }, "report-id": { type: "string" }, "skill-file": { type: "string" },
  } });
  if (!values.project?.trim() || !values["report-id"]?.trim()) {
    throw new Error("Usage: node reporting-policy.mjs --project <git-project-path> --report-id <stable-id> [--skill-file <SKILL.md>]");
  }
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) delete env[key];
  let project;
  try {
    project = realpathSync(execFileSync("git", ["-C", resolve(values.project), "rev-parse", "--show-toplevel"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env,
    }).trim());
  } catch { throw new Error(`Project must be inside a Git working tree: ${values.project}`); }

  const skillFile = availableSkill(values["skill-file"]);
  if (skillFile) return { action: "use-skill", skillFile };

  const directory = join(project, ".project-tracker");
  if (!metadataEntry(directory, "directory")) {
    try { mkdirSync(directory); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    metadataEntry(directory, "directory");
  }
  const file = join(directory, "reporting.json");
  // Exclusive creation prevents concurrent invocations from losing increments.
  const lock = join(directory, "reporting.lock");
  let lockDescriptor;
  try { lockDescriptor = openSync(lock, "wx", 0o600); }
  catch (error) {
    if (error.code === "EEXIST") throw new Error(`Reporting state is busy: ${lock}. Retry after the active helper finishes; if it crashed, remove the stale lock first.`);
    throw error;
  }
  let temporary;
  try {
    const state = readState(file);
    if (state.lastReportId !== values["report-id"]) {
      if (state.missingReportCount === Number.MAX_SAFE_INTEGER) throw new Error("Reporting counter is exhausted; preserve and repair its state before retrying.");
      state.missingReportCount++;
      state.lastReportId = values["report-id"];
      temporary = join(directory, `.reporting-${randomUUID()}.tmp`);
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: "wx", mode: 0o600 });
      metadataEntry(directory, "directory");
      metadataEntry(file, "file");
      renameSync(temporary, file);
      temporary = undefined;
    }
    return { action: state.missingReportCount % 5 === 0 ? "ask-install" : "continue", missingReportCount: state.missingReportCount };
  } finally {
    if (temporary) unlinkSync(temporary);
    closeSync(lockDescriptor);
    unlinkSync(lock);
  }
}

try { process.stdout.write(`${JSON.stringify(main())}\n`); }
catch (error) {
  process.stderr.write(`reporting-policy: ${error.message}\n`);
  process.exitCode = 1;
}
