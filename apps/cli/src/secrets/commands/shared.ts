import { isCancel, password } from "@clack/prompts";
import { SecretNotFound, type SecretResolver, type ValidateManifestOptions } from "@duru/secrets";

export const GROUP = "Secret";

export type SecretCliDeps = {
  resolver: SecretResolver;
  manifestValidation?: ValidateManifestOptions;
};

export async function promptSecret(message: string): Promise<string | undefined> {
  const value = await password({ message });
  if (isCancel(value)) return undefined;
  return value;
}

export async function pollUntilSet(
  resolver: SecretResolver,
  ref: string,
  verify: { intervalMs: number; timeoutMs: number },
): Promise<void> {
  const deadline = Date.now() + verify.timeoutMs;
  while (Date.now() < deadline) {
    resolver.clearCache();
    const v = await resolver.resolve(ref);
    if (v !== undefined && v !== "") return;
    await new Promise((r) => setTimeout(r, verify.intervalMs));
  }
  throw new Error("Timeout — value not detected. Run `duru secret check <name>` later.");
}

export function maskValue(v: string): string {
  if (v.length <= 4) return "*".repeat(v.length);
  return `${v.slice(0, 2)}${"*".repeat(v.length - 4)}${v.slice(-2)}`;
}

export function errorMessage(err: unknown): string {
  if (err instanceof SecretNotFound) return err.message;
  return err instanceof Error ? err.message : String(err);
}

export function notFoundMessage(name: string): string {
  return `Secret "${name}" not found. Run \`duru secret list\` to see all.`;
}
