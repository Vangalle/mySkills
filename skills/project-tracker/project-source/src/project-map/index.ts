/** Small entry hints over CodeGraph's own index. No second graph or status store. */
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse } from "smol-toml";
import { z } from "zod";
import { execa } from "execa";
import { redactSessionText } from "../adapters/pi/redaction.js";
import { codeGraphCapability, requireCodeGraph } from "./codegraph-runtime.js";

const EntrySchema = z.object({
  description: z.string().max(1000).optional(),
  query: z.string().min(1).max(1000).optional(),
  paths: z.array(z.string().min(1).max(512)).max(32).default([]),
}).strict();
const MapSchema = z.object({
  version: z.literal(1),
  entries: z.record(z.string().min(1).max(80), EntrySchema).default({}),
}).strict();

/** Check an existing ancestor as well, so missing/link/child cannot escape. */
export async function localProjectPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes("\0") || path.split(/[\\/]/).includes("..")) {
    throw new Error(`path outside project: ${path}`);
  }
  const canonical = await realpath(root);
  const target = resolve(canonical, path);
  let ancestor = target;
  for (;;) {
    try {
      await lstat(ancestor);
      const actual = await realpath(ancestor);
      const delta = relative(canonical, actual);
      if (delta === ".." || delta.startsWith("../") || isAbsolute(delta)) throw new Error(`path outside project: ${path}`);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A broken symlink must not be treated as a harmless missing path.
      const info = await lstat(ancestor).catch(() => null);
      if (info?.isSymbolicLink()) throw new Error(`unresolved symbolic link: ${path}`);
      if (ancestor === canonical) throw error;
      ancestor = dirname(ancestor);
    }
  }
}

export async function inspectMap(root: string) {
  const file = await localProjectPath(root, "PROJECT_MAP.toml");
  let source: string | null = null;
  try {
    if ((await stat(file)).size > 65536) throw new Error("PROJECT_MAP.toml exceeds 64 KiB; keep only entry hints");
    source = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const map = source === null ? { version: 1 as const, entries: {} } : MapSchema.parse(parse(source));
  const missingPaths: string[] = [];
  for (const entry of Object.values(map.entries)) {
    for (const path of entry.paths) {
      const target = await localProjectPath(root, path);
      try { await stat(target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        missingPaths.push(path);
      }
    }
  }
  const loaded = codeGraphCapability();
  let indexed = false;
  if (loaded.available) {
    const canonical = await realpath(root);
    const index = await localProjectPath(canonical, relative(canonical, loaded.sdk.getDatabasePath(canonical)));
    indexed = await stat(index).then(s => s.isFile()).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    });
  }
  const capability = loaded.available
    ? { available: true as const, runtimeDir: loaded.runtimeDir }
    : loaded;
  return { provider: "codegraph" as const, capability, source: source === null ? null : "PROJECT_MAP.toml", ...map, indexed, missingPaths: [...new Set(missingPaths)] };
}

async function rejectExpandedCodeGraphScope(root: string): Promise<void> {
  const configPath = await localProjectPath(root, "codegraph.json");
  let source: string;
  try { source = await readFile(configPath, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let config: unknown;
  try { config = JSON.parse(source); } catch { return; }
  if (!config || typeof config !== "object" || Array.isArray(config)) return;
  for (const key of ["include", "includeIgnored"] as const) {
    const value = (config as Record<string, unknown>)[key];
    if (Array.isArray(value) && value.some(item => typeof item === "string" && item.length > 0)) {
      throw new Error(`CodeGraph ${key} expands indexing beyond Git-visible paths and is not supported by Project Map`);
    }
  }
}

async function checkIndexedPaths(root: string): Promise<void> {
  // Upstream follows source symlinks. Check Git-visible paths before delegating,
  // including nested Git roots, without copying its language/indexing logic.
  await rejectExpandedCodeGraphScope(root);
  const visited = new Set<string>();
  const inspectRepo = async (repo: string, prefix = ""): Promise<void> => {
    const actualRepo = await realpath(repo);
    if (visited.has(actualRepo)) return;
    visited.add(actualRepo);
    const [cached, untracked] = await Promise.all([
      execa("git", ["ls-files", "-z", "--cached"], { cwd: repo }),
      execa("git", ["ls-files", "-z", "--others", "--exclude-standard"], { cwd: repo }),
    ]);
    for (const listed of new Set(`${cached.stdout}\0${untracked.stdout}`.split("\0").filter(Boolean))) {
      const path = join(prefix, listed.replace(/[\\/]$/, ""));
      const target = await localProjectPath(root, path);
      const info = await lstat(target).catch(() => null);
      if (info?.isDirectory()) await inspectRepo(target, path);
    }
  };
  await inspectRepo(root);
}

export async function indexCodeGraph(root: string) {
  const { CodeGraph } = requireCodeGraph();
  const map = await inspectMap(root);
  await checkIndexedPaths(root);
  const graph = map.indexed ? await CodeGraph.open(root) : await CodeGraph.init(root);
  try {
    if (map.indexed) {
      const sync = await graph.sync();
      if (sync.filesChecked === 0 && sync.durationMs === 0) throw new Error("CodeGraph index is busy; synchronization was skipped");
    } else {
      const indexed = await graph.indexAll();
      if (!indexed.success) throw new Error(indexed.errors[0]?.message ?? "CodeGraph indexing failed");
    }
    const stats = graph.getStats();
    return { provider: "codegraph", files: stats.fileCount, symbols: stats.nodeCount, relations: stats.edgeCount };
  } finally { graph.close(); }
}

const NodeSchema = z.object({
  id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), startLine: z.number(), endLine: z.number(),
});
const EdgeSchema = z.object({ source: z.string(), target: z.string(), kind: z.string() });
const ContextSchema = z.object({
  nodes: z.map(z.string(), NodeSchema),
  edges: z.array(EdgeSchema),
  roots: z.array(z.string()),
  confidence: z.enum(["high", "low"]).optional(),
});
const clean = (value: string) => redactSessionText(value).text;

export interface CodeContext {
  provider: "codegraph";
  query: string;
  scope: "bounded";
  matched: boolean;
  truncated: boolean;
  syncedAt: string;
  locations: string[];
  symbols: Array<{ id: string; name: string; kind: string; path: string; line: number; endLine: number }>;
  relations: Array<{ source: string; target: string; kind: string }>;
  code: Array<{ path: string; line: number; content: string }>;
}

export async function queryCodeContext(root: string, query: string, options: { entry?: string; includeCode?: boolean; maxChars?: number } = {}): Promise<CodeContext> {
  const maxChars = options.maxChars ?? 6000;
  if (!Number.isInteger(maxChars) || maxChars < 1024 || maxChars > 60000) throw new Error("maxChars must be an integer between 1024 and 60000");
  if (!query.trim() || query.length > 1000) throw new Error("query must contain 1–1000 characters");
  const { CodeGraph } = requireCodeGraph();
  const map = await inspectMap(root);
  const entry = options.entry === undefined ? undefined : map.entries[options.entry];
  if (options.entry !== undefined && !entry) throw new Error(`unknown map entry: ${options.entry}`);
  if (!map.indexed) throw new Error('CodeGraph index missing. Run "project-tracker map index [path]" first.');
  await checkIndexedPaths(root);
  const graph = await CodeGraph.open(root);
  try {
    const sync = await graph.sync();
    if (sync.filesChecked === 0 && sync.durationMs === 0) throw new Error("CodeGraph index is busy; synchronization was skipped");
    const syncedAt = new Date().toISOString();
    const context = ContextSchema.parse(await graph.findRelevantContext([entry?.query, query].filter(Boolean).join(" "), {
      maxNodes: 12, searchLimit: 3, traversalDepth: 1,
    }));
    const matched = context.nodes.size > 0 && context.confidence !== "low";
    const nodes = matched ? [...context.nodes.values()] : [];
    const edges = matched ? context.edges : [];
    for (const node of nodes) await localProjectPath(root, node.filePath);
    const codeBlocks: Array<{ filePath: string; content: string; startLine: number }> = [];
    if (matched && options.includeCode) {
      const roots = context.roots.map(id => context.nodes.get(id)).filter((node): node is z.infer<typeof NodeSchema> => node !== undefined);
      const candidates = [...roots, ...nodes.filter(node => !context.roots.includes(node.id))];
      for (const node of candidates.slice(0, 3)) {
        const content = await graph.getCode(node.id);
        if (content !== null) codeBlocks.push({ filePath: node.filePath, startLine: node.startLine, content: content.slice(0, 3000) });
      }
    }
    const result: CodeContext = {
      provider: "codegraph", query: clean(query), scope: "bounded", matched,
      truncated: false, syncedAt, locations: (entry?.paths ?? []).map(clean),
      symbols: nodes.map(n => ({ id: n.id, name: clean(n.name), kind: n.kind, path: clean(n.filePath), line: n.startLine, endLine: n.endLine })),
      relations: edges,
      code: codeBlocks.map(c => ({ path: clean(c.filePath), line: c.startLine, content: clean(c.content) })),
    };
    // Budget the serialized payload, not an inaccurate token estimate. Never cut JSON syntax.
    while (JSON.stringify(result).length > maxChars) {
      result.truncated = true;
      const largeCode = result.code.find(c => c.content.length > 200);
      if (largeCode) { largeCode.content = largeCode.content.slice(0, Math.floor(largeCode.content.length / 2)) + "\n[truncated]"; continue; }
      if (result.code.length) { result.code.pop(); continue; }
      if (result.relations.length) { result.relations.pop(); continue; }
      if (result.locations.length) { result.locations.pop(); continue; }
      if (result.symbols.length) { result.symbols.pop(); continue; }
      result.query = result.query.slice(0, Math.floor(result.query.length / 2));
    }
    const ids = new Set(result.symbols.map(n => n.id));
    result.relations = result.relations.filter(e => ids.has(e.source) && ids.has(e.target));
    return result;
  } finally { graph.close(); }
}
