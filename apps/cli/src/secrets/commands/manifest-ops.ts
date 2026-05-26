import type { Cli } from "@duru/cli-kit";
import { loadManifest, mutateManifest, parseReference } from "@duru/secrets";
import { manifestPath } from "../manifest-path.ts";
import { GROUP, type SecretCliDeps, errorMessage, notFoundMessage } from "./shared.ts";

export function registerManifestOps(cli: Cli, deps: SecretCliDeps): void {
  registerAdd(cli, deps);
  registerRemove(cli, deps);
  registerRename(cli, deps);
  registerList(cli, deps);
  registerShow(cli, deps);
}

function registerAdd(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("add <name> <ref>")
    .meta({ description: "Add a secret name → ref mapping to the manifest" })
    .group(GROUP)
    .option("--overwrite", "Replace existing entry if name already exists")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const ref = ctx.params.ref as string;
      const overwrite = Boolean(ctx.options.overwrite);
      try {
        parseReference(ref);
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
      try {
        await mutateManifest(
          manifestPath(),
          (m) => {
            if (m.data.secrets[name] !== undefined && !overwrite) {
              throw new Error(`Secret "${name}" already exists. Use --overwrite to replace.`);
            }
            m.data.secrets[name] = ref;
          },
          deps.manifestValidation,
        );
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
      return ctx.exit(0, { name, ref });
    });
}

function registerRemove(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("remove <name>")
    .meta({ description: "Remove a secret from the manifest (backend value untouched)" })
    .group(GROUP)
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      try {
        await mutateManifest(
          manifestPath(),
          (m) => {
            if (m.data.secrets[name] === undefined) throw new Error(notFoundMessage(name));
            delete m.data.secrets[name];
          },
          deps.manifestValidation,
        );
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
      return ctx.exit(0, { name });
    });
}

function registerRename(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("rename <old> <new>")
    .meta({ description: "Rename a secret in the manifest" })
    .group(GROUP)
    .action(async (ctx) => {
      const oldName = ctx.params.old as string;
      const newName = ctx.params.new as string;
      let ref = "";
      try {
        await mutateManifest(
          manifestPath(),
          (m) => {
            const existing = m.data.secrets[oldName];
            if (existing === undefined) throw new Error(notFoundMessage(oldName));
            if (m.data.secrets[newName] !== undefined) {
              throw new Error(`Secret "${newName}" already exists`);
            }
            ref = existing;
            m.data.secrets[newName] = existing;
            delete m.data.secrets[oldName];
          },
          deps.manifestValidation,
        );
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
      return ctx.exit(0, { from: oldName, to: newName, ref });
    });
}

function registerList(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("list")
    .meta({ description: "List all manifest secret names + refs (sorted by name)" })
    .group(GROUP)
    .action(async (ctx) => {
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const entries = Object.entries(m.data.secrets)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, ref]) => ({ name, ref }));
      return ctx.exit(0, { secrets: entries });
    });
}

function registerShow(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("show <name>")
    .meta({ description: "Show a single secret name + ref" })
    .group(GROUP)
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const ref = m.data.secrets[name];
      if (!ref) return ctx.exit(1, { error: { message: notFoundMessage(name) } });
      return ctx.exit(0, { name, ref });
    });
}
