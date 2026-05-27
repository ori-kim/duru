import { type SecretResolver, parseDotenv as parseDotenvShared } from "@duru/secrets";
import { redactSecrets, resolveSecrets } from "./secret-resolution";
import type { GatewayEnvService } from "./types";

export type ApplyTargetEnvInput = {
  manifest: { name: string; type: string };
  options: {
    services?: {
      env?: GatewayEnvService;
      secrets?: SecretResolver;
    };
  };
  secretResolution?: "resolve" | "redact";
};

export async function applyTargetEnv<T>(config: T, input: ApplyTargetEnvInput): Promise<T> {
  const env =
    (await input.options.services?.env?.loadTargetEnv({
      target: input.manifest.name,
      type: input.manifest.type,
    })) ?? new Map<string, string>();
  const interpolated = interpolate(config, env);
  const secrets = input.options.services?.secrets;
  if (!secrets) return interpolated;
  return input.secretResolution === "redact"
    ? redactSecrets(interpolated, secrets)
    : resolveSecrets(interpolated, secrets);
}

// Re-export for backwards compatibility — implementation lives in @duru/secrets.
export const parseDotenv = parseDotenvShared;

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
