export const IDENTIFIER_RE = /^[A-Za-z0-9_-]+$/;

const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DANGEROUS_RESOURCE_CHARS_RE = /[?#%]/;

export function validateIdentifier(value: string, label = "Name"): void {
  if (!value || !IDENTIFIER_RE.test(value)) {
    throw new Error(`${label} may only contain letters, digits, _ and -`);
  }
}

function hasDangerousControlChar(value: string): boolean {
  // Allow common textual whitespace while rejecting invisible/control payloads.
  return CONTROL_CHAR_RE.test(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isResourceIdKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return (
    key === "id" ||
    /(?:^|[-_])id$/i.test(key) ||
    /(?:Id|ID)$/.test(key) ||
    normalized === "resource" ||
    normalized === "resourcename" ||
    normalized === "resourceid"
  );
}

function isOutputPathKey(key: string): boolean {
  const normalized = key.replace(/[-_]/g, "").toLowerCase();
  return [
    "output",
    "outputdir",
    "outputdirectory",
    "outputpath",
    "outputfile",
    "outdir",
    "outpath",
    "outfile",
    "dest",
    "destdir",
    "destpath",
    "destfile",
    "destination",
    "destinationdir",
    "destinationpath",
    "destinationfile",
  ].includes(normalized);
}

function validateSafeOutputPath(value: string, path: string): void {
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    throw new Error(`Invalid ${path}: output paths must be relative to the current working directory`);
  }
  const segments = value.split(/[\\/]+/);
  if (segments.includes("..")) {
    throw new Error(`Invalid ${path}: output paths may not contain '..' segments`);
  }
}

function hardenString(key: string, value: string, path: string): void {
  if (hasDangerousControlChar(value)) {
    throw new Error(`Invalid ${path}: control characters are not allowed`);
  }
  if (isResourceIdKey(key) && DANGEROUS_RESOURCE_CHARS_RE.test(value)) {
    throw new Error(`Invalid ${path}: resource identifiers may not contain ?, #, or %`);
  }
  if (isOutputPathKey(key)) {
    validateSafeOutputPath(value, path);
  }
}

export function hardenAgentInput(value: unknown, path = "input", key = ""): void {
  if (typeof value === "string") {
    hardenString(key, value, path);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => hardenAgentInput(item, `${path}[${index}]`, key));
    return;
  }

  if (isPlainRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      hardenAgentInput(childValue, `${path}.${childKey}`, childKey);
    }
  }
}

export function hardenToolInput(input: Record<string, unknown>): Record<string, unknown> {
  hardenAgentInput(input, "args");
  return input;
}
