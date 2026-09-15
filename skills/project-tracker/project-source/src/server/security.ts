/**
 * Local security rules for the dashboard (section 6.3).
 *
 * - Bind 127.0.0.1 + random port by default.
 * - Reject non-loopback Host headers outright (no warning-and-continue path).
 * - Non-loopback binding is refused in v1.
 * - Responses are no-store.
 */
import type { FastifyReply, FastifyRequest } from "fastify";

const LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "::1",
]);

export function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const bare = host.split(":")[0]?.replace(/^\[/, "").replace(/\]$/, "");
  return LOOPBACK_HOSTS.has(bare ?? "");
}

/** Fastify hook: reject requests with non-loopback Host. */
export async function enforceLoopbackHost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const host = request.headers.host;
  if (!isLoopbackHost(host)) {
    await reply.code(403).send({
      error: "forbidden",
      message: "dashboard only accepts loopback Host headers",
    });
  }
}

/** Fastify hook: same-origin policy for browser requests. */
export async function enforceOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const origin = request.headers.origin;
  if (!origin) return; // non-browser clients / same-origin navigations
  const host = request.headers.host;
  let originHost: string | null = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost !== host) {
    await reply.code(403).send({ error: "forbidden", message: "cross-origin requests are not allowed" });
  }
}

export function setNoStoreHeaders(reply: FastifyReply): void {
  reply.header("Cache-Control", "no-store");
  reply.header("X-Content-Type-Options", "nosniff");
}

export interface SecurityCheckResult {
  ok: boolean;
  reason?: string;
}

/** v1 policy: refuse to start a non-loopback server. No bypass. */
export function checkBindPolicy(host: string): SecurityCheckResult {
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      `refusing to bind ${host}: project-tracker 0.1.x is loopback-only. ` +
      "Authentication is required before non-loopback exposure (see docs/security.md).",
  };
}