import type { Cli } from "@duru/cli-kit";
import { loadManifest } from "@duru/secrets";
import { manifestPath } from "../manifest-path.ts";
import { GROUP, type SecretCliDeps, errorMessage, notFoundMessage } from "./shared.ts";

type CheckRow = { name: string; status: "ok" | "missing" | "error"; message?: string };

export function registerVerifyOps(cli: Cli, deps: SecretCliDeps): void {
  registerCheck(cli, deps);
  registerValidate(cli, deps);
}

function registerCheck(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("check [name]")
    .meta({ description: "Verify backend reachability for all (or one) manifest secret" })
    .group(GROUP)
    .action(async (ctx) => {
      const onlyName = ctx.params.name as string | undefined;
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const entries: [string, string][] = Object.entries(m.data.secrets);
      const targets = onlyName ? entries.filter(([n]) => n === onlyName) : entries;
      if (onlyName && targets.length === 0) {
        return ctx.exit(1, { error: { message: notFoundMessage(onlyName) } });
      }

      const results: CheckRow[] = [];
      for (const [name, ref] of targets) {
        deps.resolver.clearCache();
        try {
          const v = await deps.resolver.resolve(ref);
          results.push({ name, status: v === undefined ? "missing" : "ok" });
        } catch (err) {
          results.push({ name, status: "error", message: errorMessage(err) });
        }
      }
      const ok = results.every((r) => r.status === "ok");
      return ctx.exit(ok ? 0 : 1, { results });
    });
}

function registerValidate(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("validate")
    .meta({ description: "Validate manifest schema + ref syntax" })
    .group(GROUP)
    .action(async (ctx) => {
      try {
        const m = await loadManifest(manifestPath(), deps.manifestValidation);
        return ctx.exit(0, { valid: true, count: Object.keys(m.data.secrets).length });
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
    });
}
