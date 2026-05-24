import { createRouter } from "@duru/cli-kit";
import { type UpdateOptions, defaultDeps, runUpdate } from "./update.ts";

export const updateCommand = createRouter();

updateCommand
  .command("update")
  .meta({ description: "Update duru to the latest release" })
  .group("Built-in")
  .option("--check", "Show latest version without updating")
  .option("--version <tag>", "Install a specific release tag")
  .option("--yes", "Skip confirmation prompt")
  .option("--dry-run", "Show what would change without downloading")
  .option("--force", "Reinstall even if already on latest version")
  .action(async (ctx) => {
    const options: UpdateOptions = {
      check: Boolean(ctx.options.check),
      dryRun: Boolean(ctx.options.dryRun),
      force: Boolean(ctx.options.force),
      yes: Boolean(ctx.options.yes),
      tag: ctx.options.version as string | undefined,
    };
    await runUpdate(options, defaultDeps);
  });
