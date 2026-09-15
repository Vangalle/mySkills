/**
 * Redaction for anything extracted from Pi sessions before it can reach the
 * model bundle, cache, API, or PROJECT_STATE.md (section: security).
 */

export interface RedactedText {
  text: string;
  redactionCount: number;
  redactedPatterns: string[];
}

interface RedactionRule {
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string) => string);
}

const RULES: RedactionRule[] = [
  {
    name: "bearer_token",
    pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    name: "authorization_header",
    pattern: /Authorization\s*[:=]\s*(Bearer|Basic|token)\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "Authorization: [REDACTED]",
  },
  {
    name: "openai_style_key",
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{12,}/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "aws_access_key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  {
    name: "aws_secret_key",
    pattern: /\baws_secret_access_key\b\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}/gi,
    replacement: "aws_secret_access_key=[REDACTED]",
  },
  {
    name: "slack_token",
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g,
    replacement: "[REDACTED_API_KEY]",
  },
  {
    name: "secret_assignment",
    pattern:
      /\b[a-z0-9_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?[^\s"'}{,;]{6,}/gi,
    replacement: (match: string) => {
      const eq = match.search(/[:=]/);
      const name = match.slice(0, eq);
      return `${name}=[REDACTED]`;
    },
  },
];

export function redactSessionText(text: string): RedactedText {
  let redactionCount = 0;
  const redactedPatterns = new Set<string>();
  let result = text;

  for (const rule of RULES) {
    result = result.replace(rule.pattern, (...args: unknown[]) => {
      redactionCount += 1;
      redactedPatterns.add(rule.name);
      if (typeof rule.replacement === "function") {
        return rule.replacement(args[0] as string);
      }
      return rule.replacement;
    });
  }

  return { text: result, redactionCount, redactedPatterns: [...redactedPatterns] };
}

export function truncateText(text: string, maxChars: number): string {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

/** Combined helper used by the parser for every extracted text block. */
export function redactAndTruncate(text: string, maxChars: number): string {
  const { text: redacted } = redactSessionText(text);
  return truncateText(redacted, maxChars);
}