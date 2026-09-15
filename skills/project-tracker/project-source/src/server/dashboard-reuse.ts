import { z } from "zod";
export type ReuseResult = { status: "matching"; url: string; pid: number } | { status: "unreachable" } | { status: "mismatch"; message: string };
export async function inspectDashboardReuse(roots: string[], marker: { port: number; pid: number }): Promise<ReuseResult> {
  if (!Number.isInteger(marker.port) || marker.port < 1 || marker.port > 65535 || !Number.isInteger(marker.pid) || marker.pid < 1) {
    return { status: "mismatch", message: "invalid dashboard marker" };
  }
  const url = `http://127.0.0.1:${marker.port}`;
  try {
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    const info = z.object({ ok: z.literal(true), name: z.literal("project-tracker") }).safeParse(await health.json());
    if (!health.ok || !info.success) return { status: "mismatch", message: "running service is not a healthy Tracker dashboard" };
    const response = await fetch(`${url}/api/projects`, { signal: AbortSignal.timeout(1500), redirect: "error" });
    const registry = z.object({ projects: z.array(z.object({ root: z.string() })) }).parse(await response.json());
    if (!response.ok || !roots.every(root => registry.projects.some(project => project.root === root))) {
      return { status: "mismatch", message: "running dashboard does not contain the requested project; existing service was left untouched" };
    }
    return { status: "matching", url, pid: marker.pid };
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "ECONNREFUSED") return { status: "unreachable" };
    return { status: "mismatch", message: "dashboard identity could not be verified; existing service was left untouched" };
  }
}
