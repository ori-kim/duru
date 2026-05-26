import type { SecretClient } from "@duru/secrets";

export type AutoInjectOptions = {
  onError?: (input: { name: string; error: unknown }) => void;
};

/**
 * Inject manifest secrets whose name matches autoInject.prefix into process.env.
 * Existing process.env values take precedence (shell export wins).
 */
export async function autoInjectDuruEnv(client: SecretClient, options: AutoInjectOptions = {}): Promise<void> {
  const manifest = client.manifest();
  if (!manifest.data.autoInject.enabled) return;
  const prefix = manifest.data.autoInject.prefix;

  for (const name of client.list()) {
    if (!name.startsWith(prefix)) continue;
    if (process.env[name] !== undefined) continue;
    try {
      const value = await client.getOptional(name);
      if (value !== undefined) process.env[name] = value;
    } catch (error) {
      options.onError?.({ name, error });
    }
  }
}
