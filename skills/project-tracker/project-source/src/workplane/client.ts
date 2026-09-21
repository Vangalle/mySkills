/**
 * Optional Workplane plugin client.
 *
 * Tracker invokes `workplane plugin` with an argument array (no shell), a
 * bounded timeout and bounded output, then validates the response before
 * trusting it. Every failure mode degrades to a typed status; a previous
 * success is never reused, and raw subprocess output is never surfaced.
 */
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { PluginResponseSchema, WORKPLANE_PROTOCOL_VERSION, type WorkplaneTrackerSnapshot } from "./protocol.js";

export type WorkplanePlaneDocument = Extract<
  ReturnType<typeof PluginResponseSchema.parse>,
  { status: "ok" }
>["document"];

export type WorkplaneResult =
  | { status: "ready"; document: WorkplanePlaneDocument; html: string; mermaid: string }
  | { status: "not_configured"; message: string }
  | { status: "unavailable" | "incompatible" | "invalid" | "failed"; message: string; errors?: string[] };

export interface WorkplaneClient {
  evaluate(input: {
    root: string;
    definition?: unknown;
    snapshot: WorkplaneTrackerSnapshot;
  }): Promise<WorkplaneResult>;
}

export interface WorkplaneClientOptions {
  command?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

interface ExecaResultLike {
  timedOut?: boolean;
  isMaxBuffer?: boolean;
  exitCode?: number;
  stdout?: string;
  code?: string;
}

function parseSingleJson(stdout: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(stdout) };
  } catch {
    return { ok: false };
  }
}

export function createWorkplaneClient(options: WorkplaneClientOptions = {}): WorkplaneClient {
  const command = options.command ?? "workplane";
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;

  async function loadDefinition(
    root: string,
  ): Promise<{ ok: true; definition: unknown } | { ok: false; result: WorkplaneResult }> {
    const path = join(root, "WORKPLANE.json");
    const info = await lstat(path).then(
      (value) => value,
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)),
    );
    if (info === null) {
      return { ok: false, result: { status: "not_configured", message: "WORKPLANE.json is missing" } };
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      return {
        ok: false,
        result: { status: "invalid", message: "WORKPLANE.json must be a regular file", errors: [] },
      };
    }
    try {
      const definition = JSON.parse(await readFile(path, "utf8"));
      return { ok: true, definition };
    } catch {
      return { ok: false, result: { status: "invalid", message: "WORKPLANE.json is not valid JSON", errors: [] } };
    }
  }

  return {
    async evaluate({ root, definition, snapshot }) {
      let candidate = definition;
      if (candidate === undefined) {
        const loaded = await loadDefinition(root);
        if (!loaded.ok) return loaded.result;
        candidate = loaded.definition;
      }

      const input = JSON.stringify({
        protocolVersion: WORKPLANE_PROTOCOL_VERSION,
        definition: candidate,
        tracker: snapshot,
      });

      let result: ExecaResultLike;
      try {
        result = (await execa(command, ["plugin"], {
          input,
          reject: false,
          shell: false,
          timeout: timeoutMs,
          maxBuffer: maxOutputBytes,
        })) as unknown as ExecaResultLike;
      } catch (error) {
        const failure = error as NodeJS.ErrnoException & { isMaxBuffer?: boolean; code?: string };
        if (failure.code === "ENOENT") {
          return { status: "unavailable", message: "workplane command is not installed" };
        }
        return { status: "failed", message: "workplane plugin invocation failed" };
      }

      if ((result as unknown as { code?: string }).code === "ENOENT") {
        return { status: "unavailable", message: "workplane command is not installed" };
      }
      if (result.timedOut || result.isMaxBuffer) {
        return { status: "failed", message: "workplane plugin did not complete within its bounds" };
      }
      if (result.stdout && Buffer.byteLength(result.stdout) > maxOutputBytes) {
        return { status: "failed", message: "workplane plugin exceeded the output bound" };
      }

      const parsed = parseSingleJson(result.stdout ?? "");
      if (!parsed.ok) {
        return { status: "failed", message: "workplane plugin returned malformed output" };
      }

      if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
        return { status: "failed", message: "workplane plugin returned an unexpected response" };
      }
      const raw = parsed.value as { protocolVersion?: unknown };
      if (typeof raw.protocolVersion === "string" && raw.protocolVersion !== WORKPLANE_PROTOCOL_VERSION) {
        return { status: "incompatible", message: "Workplane protocol version mismatch" };
      }

      const validated = PluginResponseSchema.safeParse(parsed.value);
      if (!validated.success) {
        return { status: "failed", message: "workplane plugin returned an unexpected response" };
      }
      if (validated.data.status === "invalid") {
        return {
          status: "invalid",
          message: "workplane rejected the definition",
          errors: validated.data.errors.map((entry) => `${entry.path}: ${entry.message}`.trim()),
        };
      }
      if (result.exitCode !== 0) {
        return { status: "failed", message: "workplane plugin exited with an error" };
      }
      return {
        status: "ready",
        document: validated.data.document,
        html: validated.data.html,
        mermaid: validated.data.mermaid,
      };
    },
  };
}
