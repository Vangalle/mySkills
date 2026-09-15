/**
 * Loopback dashboard server (section 6.3).
 *
 * Binds 127.0.0.1 on a random port, writes a PID/port marker file into the
 * user cache directory, refuses non-loopback binds, and serves the built web
 * UI when available.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { mkdir, writeFile, readFile, rm, readFile as readFileAsync } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrackerConfig, type TrackerConfig } from "../config.js";
import { discoverProject } from "../discovery/project-discovery.js";
import { registerApi, type ApiContext } from "./api.js";
import { enforceLoopbackHost, enforceOrigin, checkBindPolicy } from "./security.js";

export interface DashboardHandle {
  url: string;
  port: number;
  pid: number;
  markerFile: string;
  close: () => Promise<void>;
}

function markerFileFor(cacheDir: string): string {
  return join(cacheDir, "dashboard.json");
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function webDistDir(): string {
  // dist/server/server.js → project-tracker/web/dist
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "web", "dist");
}

/**
 * Build the Fastify app (loopback-only policy, read-only API, optional
 * static web UI) without binding a port. Used by tests and by startDashboard.
 */
export async function buildApp(ctx: ApiContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.addHook("onRequest", enforceLoopbackHost);
  app.addHook("onRequest", enforceOrigin);
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
  });
  await registerApi(app, ctx);

  // Single not-found handler: serve the static web UI when it has been built
  // with `npm run build:web`, otherwise return a plain API 404.
  const dist = webDistDir();
  app.setNotFoundHandler(async (request, reply) => {
    if (request.method === "GET" && existsSync(dist)) {
      const urlPath = decodeURIComponent(request.url.split("?")[0] ?? "/");
      const candidates =
        urlPath === "/" || urlPath === ""
          ? ["index.html"]
          : [join(".", urlPath), join(".", urlPath, "index.html")];
      for (const candidate of candidates) {
        if (candidate.includes("..")) continue;
        const file = join(dist, candidate);
        if (!file.startsWith(dist)) continue;
        if (!existsSync(file)) continue;
        const content = await readFileAsync(file);
        const ext = candidate.slice(candidate.lastIndexOf("."));
        reply.type(MIME_TYPES[ext] ?? "application/octet-stream");
        return reply.send(content);
      }
    }
    return reply
      .code(404)
      .send({ error: "not_found", message: `unknown route ${request.method} ${request.url}` });
  });

  return app;
}

export async function readDashboardMarker(
  config: TrackerConfig = loadTrackerConfig(),
): Promise<{ port: number; pid: number } | null> {
  try {
    const raw = await readFile(markerFileFor(config.cacheDir), "utf8");
    const parsed = JSON.parse(raw) as { port?: number; pid?: number };
    if (typeof parsed.port === "number" && typeof parsed.pid === "number") {
      return { port: parsed.port, pid: parsed.pid };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start (or reuse) the dashboard for the given project paths.
 * Non-loopback binds are rejected before the server starts.
 */
export async function startDashboard(
  projectPaths: string[],
  options: { host?: string; port?: number; config?: TrackerConfig } = {},
): Promise<DashboardHandle> {
  const host = options.host ?? "127.0.0.1";
  const policy = checkBindPolicy(host);
  if (!policy.ok) {
    throw new Error(policy.reason);
  }

  const config = options.config ?? loadTrackerConfig();
  const roots: string[] = [];
  for (const input of projectPaths) {
    const discovery = await discoverProject(input, {
      extraProjectPaths: config.extraProjectPaths,
    });
    if (discovery.ok && !roots.includes(discovery.scope.root)) {
      roots.push(discovery.scope.root);
    }
  }
  if (roots.length === 0) {
    throw new Error("no git projects found in the given paths");
  }

  const ctx: ApiContext = {
    config,
    registry: { projects: roots },
    evidenceCache: new Map(),
  };

  const app = await buildApp(ctx);
  await app.listen({ host, port: options.port ?? 0 });
  const address = app.addresses()[0];
  if (!address) {
    await app.close();
    throw new Error("dashboard failed to bind a loopback address");
  }

  await mkdir(config.cacheDir, { recursive: true });
  const markerFile = markerFileFor(config.cacheDir);
  await writeFile(
    markerFile,
    JSON.stringify({ port: address.port, pid: process.pid, startedAt: new Date().toISOString() }),
    "utf8",
  );

  return {
    url: `http://127.0.0.1:${address.port}`,
    port: address.port,
    pid: process.pid,
    markerFile,
    close: async () => {
      await app.close();
      const marker = await readDashboardMarker(config);
      if (marker?.port === address.port && marker.pid === process.pid) await rm(markerFile, { force: true });
    },
  };
}