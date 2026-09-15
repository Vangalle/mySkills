import type { Command } from "commander";
import { inspectMap, indexCodeGraph, queryCodeContext, type CodeContext } from "./index.js";

function renderContext(context: CodeContext): string {
  const labels = new Map(context.symbols.map(s => [s.id, s.name]));
  return [
    `CodeGraph · ${context.query}`, "",
    ...context.locations.map(p => `Entry: ${p}`),
    ...context.symbols.map(s => `${s.name} (${s.kind}) — ${s.path}:${s.line}-${s.endLine}`),
    ...context.relations.map(e => `${labels.get(e.source)} —${e.kind}→ ${labels.get(e.target)}`),
    ...context.code.map(c => `\n${c.path}:${c.line}\n${c.content}`),
    !context.matched ? "No matching symbols. Try an exact symbol or file name." : "",
    context.truncated ? "[Output truncated to budget. Narrow the query or request more context.]" : "",
  ].filter(Boolean).join("\n");
}

export function registerMapCommands(program: Command, dependencies: {
  root: (path: string) => Promise<string>;
  stdout: (message: string) => void;
  invalid: (message: string) => Error;
}): void {
  const group = program.command("map").description("locate code using optional Map hints and the existing CodeGraph index");
  for (const command of ["inspect", "index"] as const) {
    group.command(command)
      .description(command === "inspect" ? "read entry hints and index availability without indexing" : "explicitly initialize or synchronize CodeGraph")
      .argument("[path]", "Git project", process.cwd())
      .action(async (path: string) => {
        const root = await dependencies.root(path);
        try { dependencies.stdout(JSON.stringify(await (command === "inspect" ? inspectMap(root) : indexCodeGraph(root)))); }
        catch (error) { throw dependencies.invalid((error as Error).message); }
      });
  }
  group.command("context")
    .description("get bounded symbols and relationships; source code is opt-in")
    .argument("<query>", "symbol, file, or task query")
    .argument("[path]", "Git project", process.cwd())
    .option("--entry <name>", "optional PROJECT_MAP.toml entry")
    .option("--code", "include bounded source snippets")
    .option("--max-chars <number>", "serialized character budget (1024–60000)", "6000")
    .option("--json", "output compact JSON")
    .action(async (query: string, path: string, options: { entry?: string; code?: boolean; maxChars: string; json?: boolean }) => {
      const root = await dependencies.root(path);
      try {
        const context = await queryCodeContext(root, query, { entry: options.entry, includeCode: options.code, maxChars: Number(options.maxChars) });
        dependencies.stdout(options.json ? JSON.stringify(context) : renderContext(context));
      } catch (error) { throw dependencies.invalid((error as Error).message); }
    });
}
