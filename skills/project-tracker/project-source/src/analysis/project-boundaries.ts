/**
 * Explicit project boundaries and high-value user corrections.
 *
 * AGENTS.md boundaries are opt-in: prose is never guessed to be normative.
 * Session corrections use a deliberately narrow heuristic only to preserve
 * them in the bounded model bundle; they do not become persisted boundaries.
 */
import { createHash } from "node:crypto";
import type { ProjectBoundary } from "../contracts.js";

const START_MARKER = "<!-- project-tracker:boundaries -->";
const END_MARKER = "<!-- /project-tracker:boundaries -->";

export function extractProjectBoundaries(
  markdown: string,
  sourcePath = "AGENTS.md",
): ProjectBoundary[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const boundaries: ProjectBoundary[] = [];
  let inside = false;

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (trimmed === START_MARKER) {
      inside = true;
      continue;
    }
    if (trimmed === END_MARKER) {
      inside = false;
      continue;
    }
    if (!inside) continue;

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (!bullet) continue;
    const statement = bullet[1]!.trim();
    if (!statement) continue;
    const digest = createHash("sha256").update(`${sourcePath}\0${statement}`).digest("hex").slice(0, 12);
    boundaries.push({
      id: `boundary:agents:${digest}`,
      statement,
      sourcePath,
      line: index + 1,
    });
  }

  return boundaries;
}

export interface UserRequestForCorrection {
  sessionId: string;
  entryId: string;
  text: string;
  updatedAt: string;
}

const SCOPE_TERMS = /(demo|prototype|production(?:\s+(?:use|system|traffic|environment|transactions?))?|real[-\s]*(?:world\s+)?transactions?|routing\s+layer|真实(?:交易|订单|结果|上线)|生产(?:环境|系统|使用|流量|交易)|路由层|交易结果)/i;
const CORRECTION_TERMS = /(不(?:是|算|要|能)|尚未|未完成|没有做完|还没(?:有)?做完|只(?:是|属于)|must\s+never|do\s+not|don['’]?t|not\s+(?:real|production|finished|complete)|unfinished|incomplete|only\s+(?:a\s+)?(?:demo|prototype))/i;
const INJECTED_CONTEXT_PREFIX = /^<(?:file|skill)\b/i;

/** Find likely direct scope corrections so budget trimming cannot erase them. */
export function findExplicitUserCorrections(
  requests: readonly UserRequestForCorrection[],
  limit = 20,
): UserRequestForCorrection[] {
  return requests
    .filter((request) => {
      const text = request.text.trim();
      if (text.length > 1_000 || INJECTED_CONTEXT_PREFIX.test(text)) return false;
      return SCOPE_TERMS.test(text) && CORRECTION_TERMS.test(text);
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, limit);
}
