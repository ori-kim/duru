import type { Cli } from "@duru/cli-kit";
import { secretExport, secretImport } from "../import-export.ts";
import { manifestPath } from "../manifest-path.ts";
import { GROUP, type SecretCliDeps, errorMessage } from "./shared.ts";

export function registerMigrateOps(cli: Cli, deps: SecretCliDeps): void {
  registerImport(cli, deps);
  registerExport(cli, deps);
}

function registerImport(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("import <env-file>")
    .meta({ description: "Import a .env file into manifest + backend" })
    .group(GROUP)
    .option("--backend <scheme>", "Backend scheme to store values (default: file — works on all OS)")
    .option("--path-prefix <prefix>", "Path prefix inside backend, e.g. 'myapp/'")
    .option("--force", "Overwrite existing manifest entries")
    .action(async (ctx) => {
      const envFile = ctx.params["env-file"];
      const backend = ctx.options.backend ?? "file";
      const pathPrefix = ctx.options.pathPrefix;
      const force = Boolean(ctx.options.force);
      try {
        const result = await secretImport({
          manifestPath: manifestPath(),
          resolver: deps.resolver,
          envFile,
          backend,
          pathPrefix,
          force,
          manifestValidation: deps.manifestValidation,
        });
        return ctx.exit(0, result);
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
    });
}

function registerExport(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("export")
    .meta({ description: "Export manifest to .env or json" })
    .group(GROUP)
    .option("--format <fmt>", "'env' or 'json' (default: env)")
    .option("--with-values", "Include resolved values (otherwise refs only)")
    .action(async (ctx) => {
      const format = (ctx.options.format ?? "env") as "env" | "json";
      if (format !== "env" && format !== "json") {
        return ctx.exit(1, { error: { message: `Invalid format: ${format}` } });
      }
      const withValues = Boolean(ctx.options.withValues);
      try {
        const out = await secretExport({
          manifestPath: manifestPath(),
          resolver: deps.resolver,
          format,
          withValues,
          manifestValidation: deps.manifestValidation,
        });
        process.stdout.write(out);
        return ctx.exit(0, { format, withValues });
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
    });
}
