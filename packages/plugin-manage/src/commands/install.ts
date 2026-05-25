import { confirm, isCancel, multiselect, spinner } from "@clack/prompts";
import type { Cli } from "@duru/cli-kit";
import { fetchGitHubPlugins, parseGitHubUrl } from "../github.ts";
import { type DiscoveredPlugin, discoverPluginsInDir } from "../scan.ts";
import { copyPlugin, pluginExists, resolvePluginsDir } from "../store.ts";

export function registerInstallCommand(cli: Cli): void {
  cli
    .command("install <source>")
    .meta({ description: "Install plugins from a GitHub URL or local folder" })
    .group("Plugin")
    .option("--yes", "Install all discovered plugins without prompting")
    .action(async (ctx) => {
      const source = ctx.params.source as string;
      const autoYes = Boolean(ctx.options.yes);

      if (!autoYes && !process.stdout.isTTY) {
        return ctx.exit(1, {
          error: { message: "plugin install requires a TTY. Use --yes to install all without prompting." },
        });
      }

      const pluginsDir = resolvePluginsDir();

      // ── 1. Resolve source ──────────────────────────────────────────
      const s = spinner();
      const ghSource = parseGitHubUrl(source);
      let discovered: DiscoveredPlugin[];
      let cleanup: (() => Promise<void>) | undefined;

      if (ghSource) {
        s.start(`Fetching ${ghSource.owner}/${ghSource.repo}…`);
        try {
          const result = await fetchGitHubPlugins(ghSource);
          discovered = result.plugins;
          cleanup = result.cleanup;
          s.stop(`Found ${discovered.length} plugin(s) in ${ghSource.owner}/${ghSource.repo}`);
        } catch (err) {
          s.stop("Failed to fetch repository");
          return ctx.exit(1, { error: { message: err instanceof Error ? err.message : String(err) } });
        }
      } else {
        // Local path
        const { resolve } = await import("node:path");
        const absPath = resolve(source);
        s.start(`Scanning ${absPath}…`);
        discovered = await discoverPluginsInDir(absPath);
        s.stop(`Found ${discovered.length} plugin(s) in ${absPath}`);
      }

      if (discovered.length === 0) {
        await cleanup?.();
        return ctx.exit(1, { error: { message: "No plugins found in the given source." } });
      }

      // ── 2. Selection ───────────────────────────────────────────────
      let selectedNames: string[];

      if (autoYes) {
        selectedNames = discovered.map((p) => p.name);
      } else {
        const choice = await multiselect<string>({
          message: "Select plugins to install (Space to toggle, Enter to confirm)",
          options: discovered.map((p) => ({
            value: p.name,
            label: p.name,
            hint: p.description ?? "",
          })),
          required: false,
        });

        if (isCancel(choice)) {
          await cleanup?.();
          process.stdout.write("Installation cancelled.\n");
          return;
        }
        selectedNames = choice as string[];
      }

      if (selectedNames.length === 0) {
        await cleanup?.();
        process.stdout.write("Nothing selected.\n");
        return;
      }

      // ── 3. Install each selected plugin ────────────────────────────
      const installed: string[] = [];
      const skipped: string[] = [];

      for (const name of selectedNames) {
        const plugin = discovered.find((p) => p.name === name);
        if (!plugin) continue;

        const exists = await pluginExists(pluginsDir, name);
        if (exists) {
          let overwrite = autoYes;
          if (!autoYes) {
            const answer = await confirm({ message: `"${name}" is already installed. Overwrite?` });
            if (isCancel(answer)) {
              skipped.push(name);
              continue;
            }
            overwrite = answer as boolean;
          }
          if (!overwrite) {
            skipped.push(name);
            continue;
          }
          // Remove existing before copy
          const { rm } = await import("node:fs/promises");
          const { join } = await import("node:path");
          await rm(join(pluginsDir, name), { recursive: true, force: true });
        }

        await copyPlugin(plugin, pluginsDir, name);
        installed.push(name);
      }

      await cleanup?.();

      return ctx.exit(0, {
        installed,
        skipped: skipped.length > 0 ? skipped : undefined,
      });
    });
}
