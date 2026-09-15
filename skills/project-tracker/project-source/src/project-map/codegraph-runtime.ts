import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Only the public SDK surface used here; core builds without the optional SDK. */
interface Graph {
  sync(): Promise<{ filesChecked: number; durationMs: number }>;
  indexAll(): Promise<{ success: boolean; errors: Array<{ message: string }> }>;
  getStats(): { fileCount: number; nodeCount: number; edgeCount: number };
  findRelevantContext(query: string, options: { maxNodes: number; searchLimit: number; traversalDepth: number }): Promise<unknown>;
  getCode(id: string): Promise<string | null>;
  close(): void;
}
interface CodeGraphSdk {
  getDatabasePath(root: string): string;
  CodeGraph: { open(root: string): Promise<Graph>; init(root: string): Promise<Graph> };
}

export function codeGraphRuntimeDirectory(): string {
  return resolve(process.env.PROJECT_TRACKER_CODEGRAPH_DIR || join(homedir(), ".local", "share", "project-tracker", "codegraph"));
}

export function codeGraphCapability() {
  const runtimeDir = codeGraphRuntimeDirectory();
  const packagePath = join(runtimeDir, "node_modules", "@colbymchenry", "codegraph");
  const platformLibrary = join(runtimeDir, "node_modules", "@colbymchenry", `codegraph-${process.platform}-${process.arch}`, "lib", "dist", "index.js");
  const hint = "CodeGraph is optional. After separate user confirmation, run node <tracker-source>/scripts/install-skill.mjs --skill codegraph --confirm-codegraph to install the codegraph skill and runtime. Core tracking and PROJECT_MAP.toml hints work without it.";
  // The upstream SDK can reuse a global cached platform bundle. Require the
  // addon-local bundle first so that cache or an old root install cannot opt in.
  if (!existsSync(join(packagePath, "package.json")) || !existsSync(platformLibrary)) {
    return { available: false as const, runtimeDir, reason: "CodeGraph addon runtime is not installed", hint };
  }
  try {
    const sdk = createRequire(import.meta.url)(packagePath) as CodeGraphSdk;
    if (typeof sdk.getDatabasePath !== "function" || typeof sdk.CodeGraph?.open !== "function" || typeof sdk.CodeGraph?.init !== "function") {
      throw new Error("incompatible CodeGraph SDK");
    }
    return { available: true as const, runtimeDir, sdk };
  } catch {
    return { available: false as const, runtimeDir, reason: "CodeGraph addon runtime could not be loaded", hint };
  }
}

export function requireCodeGraph(): CodeGraphSdk {
  const capability = codeGraphCapability();
  if (!capability.available) throw new Error(`${capability.reason}. ${capability.hint} Runtime directory: ${capability.runtimeDir}`);
  return capability.sdk;
}
