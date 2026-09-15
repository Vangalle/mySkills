import { z } from "zod";
import { realpath } from "node:fs/promises";
import { execa } from "execa";
import { readStateSnapshot } from "../state/onboarding.js";
import { applyStateUpdate } from "../state/atomic-writer.js";
import { redactSessionText } from "../adapters/pi/redaction.js";

const Config = z.object({ verificationAllowlist: z.array(z.string().trim().min(1)).optional() }).passthrough();
export async function readCheckConfig(root: string) {
  for (const name of [".project-tracker.json", "project-tracker.json"]) {
    const snapshot = await readStateSnapshot(root, name);
    if (snapshot.markdown !== null) {
      try { return { ...snapshot, value: Config.parse(JSON.parse(snapshot.markdown)) }; }
      catch { throw new Error(`${name} is invalid; repair it explicitly, do not overwrite it with defaults`); }
    }
  }
  return { ...await readStateSnapshot(root, ".project-tracker.json"), value: {} as z.infer<typeof Config> };
}
export const CheckSetupProposalSchema = z.object({
  projectRoot: z.string(), path: z.string(), expectedHash: z.string().nullable(), sourceHash: z.string().nullable(),
  status: z.enum(["configured", "needs_setup", "no_candidates"]),
  commands: z.array(z.object({ command: z.string(), purpose: z.string(), script: z.string() }).strict()),
}).strict();
export async function proposeChecks(root: string) {
  root = await realpath(root);
  const config = await readCheckConfig(root);
  const commands: z.infer<typeof CheckSetupProposalSchema>["commands"] = [];
  let sourceHash: string | null = null;
  const existing = config.value.verificationAllowlist ?? [];
  if (existing.length) commands.push(...existing.map(command => ({ command: redactSessionText(command).text, purpose: "已配置的检查", script: "" })));
  else {
    const ignored = await execa("git", ["check-ignore", "--no-index", "--quiet", "--", "package.json"], { cwd: root, reject: false });
    if (![0, 1].includes(ignored.exitCode ?? -1)) throw new Error("Cannot establish package.json read permissions");
    if (ignored.exitCode === 1) {
      const source = await readStateSnapshot(root, "package.json"); sourceHash = source.hash;
      if (source.markdown !== null) {
        let pkg: { packageManager?: string; scripts?: Record<string, string> };
        try { pkg = z.object({ packageManager: z.string().optional(), scripts: z.record(z.string()).optional() }).parse(JSON.parse(source.markdown)); }
        catch { throw new Error("package.json is invalid; cannot propose check defaults"); }
        const manager = pkg.packageManager?.split("@")[0] ?? "npm";
        if (["npm", "pnpm", "yarn", "bun"].includes(manager)) {
          const purposes: Record<string, string> = { test: "运行已有测试", lint: "检查代码规范", typecheck: "检查类型", build: "构建项目" };
          for (const [name, purpose] of Object.entries(purposes)) {
            const script = pkg.scripts?.[name];
            if (script?.trim() && !/no test specified/i.test(script)) commands.push({ command: `${manager} run ${name}`, purpose, script: redactSessionText(script).text });
          }
        }
      }
    }
  }
  return CheckSetupProposalSchema.parse({ projectRoot: root, path: config.path, expectedHash: config.hash, sourceHash,
    status: existing.length ? "configured" : commands.length ? "needs_setup" : "no_candidates", commands });
}
export async function applyCheckSetup(root: string, raw: unknown, confirmed: boolean) {
  if (!confirmed) throw new Error("Show proposed commands and obtain consent before --confirm; otherwise let the user configure checks manually");
  const proposal = CheckSetupProposalSchema.parse(raw);
  const current = await proposeChecks(root);
  if (JSON.stringify(current) !== JSON.stringify(proposal)) throw new Error("Check proposal changed or belongs to another project; propose and approve again");
  if (proposal.status !== "needs_setup" || !proposal.commands.length) throw new Error("No default configuration to create");
  const config = await readCheckConfig(proposal.projectRoot);
  const next = { ...config.value, verificationAllowlist: proposal.commands.map(c => c.command) };
  await applyStateUpdate(proposal.path, proposal.expectedHash, JSON.stringify(next, null, 2) + "\n");
  return { configured: true, path: proposal.path, commands: next.verificationAllowlist, executed: false };
}
