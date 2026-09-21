/**
 * Consent policy for the optional, separately owned Workplane installation.
 *
 * Workplane is never installed implicitly: a non-interactive run stays
 * Tracker-only, an interactive run asks once, and explicit flags override the
 * prompt. Contradictory flags are rejected rather than guessed at.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function resolveWorkplaneOffer(source) {
  if (!source) return null;
  const root = resolve(source);
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (typeof pkg.version === "string") version = pkg.version;
  } catch {
    // Version is informational; the installer path is what matters.
  }
  return { source: root, version, installer: join(root, "scripts", "install-skill.mjs") };
}

export async function decideWorkplaneInstall({ offer, confirm, skip, interactive, ask }) {
  if (confirm && skip) {
    throw new Error("--confirm-workplane conflicts with --without-workplane; choose one");
  }
  if (skip) return { install: false, reason: "declined" };
  if (confirm) return { install: true, reason: "accepted" };
  if (!interactive) return { install: false, reason: "non_interactive" };
  const answer = await ask(offer);
  return /^y(es)?$/i.test(String(answer).trim())
    ? { install: true, reason: "accepted" }
    : { install: false, reason: "declined" };
}
