import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { InvalidReference } from "./errors.ts";
import { acquireFileLock } from "./file-lock.ts";
import { parseReference } from "./reference.ts";

export type ManifestData = {
  secrets: Record<string, string>;
  autoInject: {
    enabled: boolean;
    prefix: string;
  };
  /**
   * Opaque key-value namespace for higher-level domains (OAuth, plugin config,
   * etc.) to attach their own validated schemas. @duru/secrets does not enforce
   * shape — each consumer validates its own key.
   */
  extensions?: Record<string, unknown>;
};

export type Manifest = {
  path: string;
  data: ManifestData;
};

export function emptyManifest(): ManifestData {
  return {
    secrets: {},
    autoInject: { enabled: true, prefix: "DURU_" },
    extensions: {},
  };
}

const VALID_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*(\/[A-Za-z0-9_]+)*$/;

export type ValidateManifestOptions = {
  /**
   * Secret name prefixes reserved by consumers (e.g., @duru/auth registers
   * "oauth/"). Manifest entries using these prefixes are rejected at validation.
   */
  reservedPrefixes?: readonly string[];
};

export function validateManifestData(
  input: unknown,
  opts: ValidateManifestOptions = {},
): asserts input is ManifestData {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Manifest must be an object");
  }
  const obj = input as Record<string, unknown>;

  if (!obj.secrets || typeof obj.secrets !== "object" || Array.isArray(obj.secrets)) {
    throw new Error("Manifest.secrets must be an object");
  }
  const reserved = opts.reservedPrefixes ?? [];
  for (const [name, ref] of Object.entries(obj.secrets as Record<string, unknown>)) {
    if (!VALID_NAME_RE.test(name)) {
      throw new Error(`Invalid secret name: ${name}`);
    }
    for (const prefix of reserved) {
      if (name.startsWith(prefix)) {
        throw new Error(`Secret name "${name}" uses reserved prefix "${prefix}"`);
      }
    }
    if (typeof ref !== "string") throw new InvalidReference(String(ref), "ref must be string");
    parseReference(ref);
  }

  const ai = obj.autoInject as Record<string, unknown> | undefined;
  if (!ai || typeof ai !== "object") throw new Error("Manifest.autoInject required");
  if (typeof ai.enabled !== "boolean") throw new Error("autoInject.enabled must be boolean");
  if (typeof ai.prefix !== "string" || ai.prefix.length === 0) {
    throw new Error("autoInject.prefix must be non-empty string");
  }

  // extensions is opaque — domain consumers validate their own slot.
  const ext = obj.extensions;
  if (ext !== undefined && (typeof ext !== "object" || ext === null || Array.isArray(ext))) {
    throw new Error("Manifest.extensions must be an object if present");
  }
}

export async function loadManifest(path: string, opts: ValidateManifestOptions = {}): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, data: emptyManifest() };
    }
    throw err;
  }
  const parsed = JSON.parse(raw);
  validateManifestData(parsed, opts);
  return { path, data: parsed };
}

export async function saveManifest(m: Manifest, opts: ValidateManifestOptions = {}): Promise<void> {
  validateManifestData(m.data, opts);
  await mkdir(dirname(m.path), { recursive: true });
  const tmp = `${m.path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(m.data, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, m.path);
}

/**
 * Run a manifest mutation under an advisory file lock to prevent concurrent
 * lost-update races. mutate() receives the current manifest, may modify
 * `data`, and the result is saved atomically.
 */
export async function mutateManifest(
  path: string,
  mutate: (m: Manifest) => Promise<void> | void,
  opts: ValidateManifestOptions = {},
): Promise<Manifest> {
  const release = await acquireFileLock(path);
  try {
    const m = await loadManifest(path, opts);
    await mutate(m);
    await saveManifest(m, opts);
    return m;
  } finally {
    await release();
  }
}
