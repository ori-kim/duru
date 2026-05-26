import type { GatewayEnvService } from "./types";

export type ApplyTargetEnvInput = {
  manifest: { name: string; type: string };
  options: {
    services?: {
      env?: GatewayEnvService;
    };
  };
};

export async function applyTargetEnv<T>(config: T, input: ApplyTargetEnvInput): Promise<T> {
  const env =
    (await input.options.services?.env?.loadTargetEnv({
      target: input.manifest.name,
      type: input.manifest.type,
    })) ?? new Map<string, string>();
  return interpolate(config, env);
}

export function parseDotenv(text: string): Map<string, string> {
  const env = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*export\s+/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!isValidKey(key)) continue;
    env.set(key, parseValue(line.slice(eq + 1).trim()));
  }
  return env;
}

function isValidKey(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key);
}

function parseValue(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return unescapeDoubleQuoted(raw.slice(1, -1));
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1);
  }
  const hashAt = raw.indexOf(" #");
  return (hashAt >= 0 ? raw.slice(0, hashAt) : raw).trim();
}

function unescapeDoubleQuoted(inner: string): string {
  return inner.replace(/\\(["\\nrt])/g, (_match, code: string) => {
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "t") return "\t";
    return code;
  });
}

const VAR_PATTERN = /\$(\$?)\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

export function interpolate<T>(value: T, env: ReadonlyMap<string, string>): T {
  return walk(value, env) as T;
}

function walk(value: unknown, env: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return substitute(value, env);
  if (Array.isArray(value)) return value.map((item) => walk(item, env));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = walk(item, env);
    return out;
  }
  return value;
}

function substitute(input: string, env: ReadonlyMap<string, string>): string {
  return input.replace(VAR_PATTERN, (_match, escapeDollar: string, name: string) => {
    if (escapeDollar === "$") return `\${${name}}`;
    return env.get(name) ?? "";
  });
}
