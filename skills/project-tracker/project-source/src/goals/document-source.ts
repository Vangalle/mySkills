/** Safe bounded document data. Reading never executes document instructions. */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { execa } from "execa";
import { marked } from "marked";
import { redactSessionText } from "../adapters/pi/redaction.js";
import type { GoalSource } from "./types.js";

/** Documents that may derive the Project Goal: whichever exist, one is enough. */
export const GOAL_ORIGIN_PATHS: readonly string[] = ["README.md", "PHILOSOPHY.md", "MARKET.md"];
/** Constraint documents bound engineering and agent behavior — never the goal. */
export const CONSTRAINT_PATHS: readonly string[] = ["RULES.md", "AGENTS.md", ".specify/memory/constitution.md"];
/** Everything the collector reads; missing entries are reported, not fatal. */
export const PRINCIPLE_PATHS = [...GOAL_ORIGIN_PATHS, ...CONSTRAINT_PATHS];
const MAX_BYTES = 64 * 1024;
export function contained(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
function permitted(path: string): boolean {
  return path.endsWith(".md") && !isAbsolute(path) && !/[\\\0]/.test(path) &&
    !path.split("/").includes("..") && !/^[\w+.-]+:/.test(path) &&
    !/(^|\/)(\.env(?:\.|$)|credentials(?:\.|\/|$)|secrets?(?:\.|\/|$)|\.git(?:\/|$))/i.test(path);
}
async function notIgnored(root: string, path: string): Promise<boolean> {
  const result = await execa("git", ["check-ignore", "--no-index", "--quiet", "--", path], { cwd: root, reject: false });
  return result.exitCode === 1;
}
export async function readProjectDocument(root: string, path: string): Promise<GoalSource> {
  const kind = path.startsWith("openspec/") ? "openspec" : path.startsWith("specs/") || path.startsWith(".specify/") ? "spec-kit" : "project";
  const result: GoalSource = { path, kind, status: "unavailable", title: path, preview: "", truncated: false, tasks: [] };
  if (!permitted(path)) return result;
  let file;
  try {
    root = await realpath(root);
    if (!await notIgnored(root, path)) return result;
    const target = await realpath(resolve(root, path));
    const local = relative(root, target);
    if (!contained(root, target) || !permitted(local) || !await notIgnored(root, local)) return result;
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await file.stat();
    if (!before.isFile()) return result;
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) return result;
    result.truncated = bytesRead > MAX_BYTES;
    const text = redactSessionText(buffer.subarray(0, Math.min(bytesRead, MAX_BYTES)).toString("utf8")).text;
    const tokens = marked.lexer(text);
    const heading = tokens.find(token => token.type === "heading");
    result.title = heading?.type === "heading" ? heading.text : path;
    result.preview = text;
    result.status = "available";
    if (!result.truncated) result.evidenceId = `document:${createHash("sha256").update(path).update("\0").update(text).digest("hex")}`;
    marked.walkTokens(tokens, token => {
      if (token.type !== "list_item" || !token.task) return;
      const first = token.tokens?.find(entry => entry.type === "text" || entry.type === "paragraph");
      result.tasks.push({ text: first && "text" in first ? String(first.text) : token.text, checked: !!token.checked });
    });
  } catch (error) {
    result.status = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable";
  } finally { await file?.close(); }
  return result;
}
