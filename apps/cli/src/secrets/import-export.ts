import { readFile } from "node:fs/promises";
import {
  type SecretResolver,
  type ValidateManifestOptions,
  loadManifest,
  mutateManifest,
  parseDotenv,
  parseReference,
} from "@duru/secrets";

export type ImportOptions = {
  manifestPath: string;
  resolver: SecretResolver;
  envFile: string;
  backend: string;
  pathPrefix?: string;
  force?: boolean;
  manifestValidation?: ValidateManifestOptions;
};

export type ImportResult = {
  added: string[];
  skipped: string[];
  overwritten: string[];
};

export async function secretImport(opts: ImportOptions): Promise<ImportResult> {
  const raw = await readFile(opts.envFile, "utf8");
  const entries = parseDotenv(raw);

  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];

  await mutateManifest(
    opts.manifestPath,
    async (manifest) => {
      for (const [name, value] of entries) {
        const pathPart = opts.pathPrefix ? `${opts.pathPrefix}${name.toLowerCase()}` : name.toLowerCase();
        const ref = `${opts.backend}://${pathPart}`;
        parseReference(ref);

        const existed = manifest.data.secrets[name] !== undefined;
        if (existed && !opts.force) {
          skipped.push(name);
          continue;
        }
        manifest.data.secrets[name] = ref;
        await opts.resolver.store(ref, value);
        if (existed) overwritten.push(name);
        else added.push(name);
      }
    },
    opts.manifestValidation,
  );

  return { added, skipped, overwritten };
}

export type ExportOptions = {
  manifestPath: string;
  resolver: SecretResolver;
  format: "env" | "json";
  withValues?: boolean;
  manifestValidation?: ValidateManifestOptions;
};

export async function secretExport(opts: ExportOptions): Promise<string> {
  const manifest = await loadManifest(opts.manifestPath, opts.manifestValidation);
  const entries = Object.entries(manifest.data.secrets).sort(([a], [b]) => a.localeCompare(b));

  if (opts.format === "env") {
    const lines: string[] = [];
    for (const [name, ref] of entries) {
      if (opts.withValues) {
        const v = await opts.resolver.resolve(ref);
        const escaped = escapeDotenvValue(v ?? "");
        lines.push(`# ${ref}`);
        lines.push(`${name}="${escaped}"`);
      } else {
        lines.push(`# ${name} → ${ref}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  if (opts.withValues) {
    const out: Record<string, string> = {};
    for (const [name, ref] of entries) {
      out[name] = (await opts.resolver.resolve(ref)) ?? "";
    }
    return `${JSON.stringify(out, null, 2)}\n`;
  }
  return `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`;
}

/**
 * Escape a value for round-trippable double-quoted .env output.
 * Matches the decoder in @duru/secrets/dotenv.ts (unescapes \n, \r, \t, \", \\).
 */
function escapeDotenvValue(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}
