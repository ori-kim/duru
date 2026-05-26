import { InvalidReference } from "./errors.ts";

export type SecretRef = {
  scheme: string;
  path: string;
};

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\/(.+)$/;
const SCHEME_BLACKLIST = new Set(["http", "https", "ws", "wss", "ftp", "ssh"]);

export function parseReference(ref: string): SecretRef {
  if (typeof ref !== "string" || ref.length === 0) {
    throw new InvalidReference(ref, "ref must be non-empty string");
  }
  const m = SCHEME_RE.exec(ref);
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new InvalidReference(ref, "missing or invalid scheme://path format");
  }
  return { scheme: m[1], path: m[2] };
}

export function isSecretRefString(value: unknown, knownSchemes: readonly string[]): value is string {
  if (typeof value !== "string") return false;
  const m = SCHEME_RE.exec(value);
  if (!m || m[1] === undefined) return false;
  const scheme = m[1];
  if (SCHEME_BLACKLIST.has(scheme)) return false;
  return knownSchemes.includes(scheme);
}
