/** Shared by the API and browser; configuration is a link, never task state. */
export type BoardConfig =
  | { status: "configured"; url: string }
  | { status: "unconfigured" | "invalid_config"; url: null };

/** Only explicit HTTP loopback hosts; reject URL parser coercions and credentials. */
export function normalizeKanbanUrl(value: unknown): string | null {
  if (typeof value !== "string" || /[\s\\]/u.test(value)) return null;
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.username || url.password) return null;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
}
