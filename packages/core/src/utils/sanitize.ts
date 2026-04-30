import type { TargetResult } from "./output.ts";

const SECRET_KEY_PATTERN =
  /((?:["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|pwd|token)\b["']?\s*[:=]\s*)["']?)([^"',}\s]{4,})(["']?)/gi;
const BEARER_PATTERN = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{12,})\b/g;
const BASIC_PATTERN = /\b(Basic\s+)([A-Za-z0-9+/=]{12,})\b/g;
const GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{20,}\b/g;
const AWS_ACCESS_KEY_PATTERN = /\bAKI[AP][A-Z0-9]{16}\b/g;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions)\b/i,
  /\bexfiltrate\b/i,
  /\b(?:send|upload|post)\b.{0,80}\b(?:password|token|secret|api[_-]?key)\b/i,
];

type SanitizeTextResult = {
  text: string;
  redactions: number;
  promptInjection: boolean;
};

function redactWhole(text: string, pattern: RegExp): { text: string; count: number } {
  let count = 0;
  const redacted = text.replace(pattern, () => {
    count++;
    return "[REDACTED]";
  });
  return { text: redacted, count };
}

function sanitizeText(text: string): SanitizeTextResult {
  let redactions = 0;
  let sanitized = text.replace(SECRET_KEY_PATTERN, (_match, prefix: string, _value: string, suffix: string) => {
    redactions++;
    return `${prefix}[REDACTED]${suffix}`;
  });

  sanitized = sanitized.replace(BEARER_PATTERN, (_match, prefix: string) => {
    redactions++;
    return `${prefix}[REDACTED]`;
  });

  sanitized = sanitized.replace(BASIC_PATTERN, (_match, prefix: string) => {
    redactions++;
    return `${prefix}[REDACTED]`;
  });

  for (const pattern of [GITHUB_TOKEN_PATTERN, OPENAI_KEY_PATTERN, AWS_ACCESS_KEY_PATTERN, JWT_PATTERN]) {
    const result = redactWhole(sanitized, pattern);
    sanitized = result.text;
    redactions += result.count;
  }

  return {
    text: sanitized,
    redactions,
    promptInjection: PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text)),
  };
}

function appendWarning(stderr: string, warning: string): string {
  const prefix = stderr && !stderr.endsWith("\n") ? `${stderr}\n` : stderr;
  return `${prefix}${warning}\n`;
}

export function sanitizeTargetResult(result: TargetResult): TargetResult {
  const stdout = sanitizeText(result.stdout);
  const stderr = sanitizeText(result.stderr);
  let nextStderr = stderr.text;

  if (stdout.redactions + stderr.redactions > 0) {
    nextStderr = appendWarning(nextStderr, "[clip:sanitize] redacted sensitive-looking output");
  }
  if (stdout.promptInjection || stderr.promptInjection) {
    nextStderr = appendWarning(nextStderr, "[clip:sanitize] potential prompt-injection text detected in target output");
  }

  return {
    exitCode: result.exitCode,
    stdout: stdout.text,
    stderr: nextStderr,
  };
}
