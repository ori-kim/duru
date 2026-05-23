import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCli } from "@duru/cli-kit";
import {
  discoverVirtualPluginManifests,
  installVirtualPlugins,
  isVirtualPlugin,
  virtualPlugin,
} from "@duru/virtual-plugins";

describe("@duru/virtual-plugins", () => {
  test("creates identifiable virtual plugin installers", async () => {
    const calls: string[] = [];
    const plugin = virtualPlugin(async (cli) => {
      calls.push("install");
      cli.command("inspect").action(() => ({ ok: true }));
    });

    expect(isVirtualPlugin(plugin)).toBe(true);

    const cli = createCli();
    await plugin.install(cli);
    const result = await cli.run(["inspect"], { render: false });

    expect(calls).toEqual(["install"]);
    expect(result.result).toEqual({ ok: true });
  });

  test("discovers TOML and YAML manifests sorted by order then name", async () => {
    const pluginsDir = await createPluginsDir();
    await writePluginManifest(
      pluginsDir,
      "beta",
      "duru.plugin.toml",
      `
        # beta plugin
        name = "beta"
        entry = "./beta.ts"
        enabled = true
        order = 200
      `,
    );
    await writePluginManifest(
      pluginsDir,
      "alpha",
      "duru.plugin.yml",
      `
        # alpha plugin
        name: alpha
        entry: ./alpha.ts
        enabled: true
        order: 100
      `,
    );
    await writePluginManifest(
      pluginsDir,
      "skip",
      "duru.plugin.yaml",
      `
        name: skip
        entry: ./skip.ts
        enabled: false
        order: 1
      `,
    );

    const manifests = await discoverVirtualPluginManifests({ pluginsDir });

    expect(manifests.map((item) => item.name)).toEqual(["alpha", "beta"]);
    expect(manifests.map((item) => item.order)).toEqual([100, 200]);
    expect(manifests[0]?.manifestPath).toBe(join(pluginsDir, "alpha", "duru.plugin.yml"));
    expect(manifests[0]?.entryPath).toBe(join(pluginsDir, "alpha", "alpha.ts"));
  });

  test("returns an empty manifest list when the plugin directory is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-home-"));

    const manifests = await discoverVirtualPluginManifests({ home });

    expect(manifests).toEqual([]);
  });

  test("rejects plugin directories with multiple manifests", async () => {
    const pluginsDir = await createPluginsDir();
    const pluginDir = await writePluginManifest(
      pluginsDir,
      "example",
      "duru.plugin.toml",
      `
        name = "example"
        entry = "./plugin.ts"
      `,
    );
    await writeFile(
      join(pluginDir, "duru.plugin.yml"),
      `
        name: example
        entry: ./plugin.ts
      `,
    );

    await expect(discoverVirtualPluginManifests({ pluginsDir })).rejects.toThrow(
      `Multiple virtual plugin manifests found in ${pluginDir}`,
    );
  });

  test("installs virtual plugin middleware and multiple routes", async () => {
    const pluginsDir = await createPluginsDir();
    await writePluginManifest(
      pluginsDir,
      "example",
      "duru.plugin.toml",
      `
        name = "example"
        entry = "./plugin.ts"
      `,
    );
    await writeFile(
      join(pluginsDir, "example", "plugin.ts"),
      `
        import { createCli, createPlugin } from "${coreModuleUrl()}";
        import { virtualPlugin } from "${virtualPluginsModuleUrl()}";

        export default virtualPlugin((cli) => {
          cli.use(createPlugin((api) => {
            api.middleware(async (ctx, next) => {
              ctx.setService("source", "virtual");
              return next();
            });
          }));

          const notes = createCli();
          notes.command("search <query>").action((ctx) => ({
            query: ctx.params.query,
            source: ctx.service("source"),
          }));

          const admin = createCli();
          admin.command("inspect").action(() => ({ status: "ok" }));

          cli.route("notes", notes);
          cli.route("admin", admin);
        });
      `,
    );

    const cli = createCli();
    cli.command("main").action(() => ({ app: "main" }));

    const installed = await installVirtualPlugins(cli, { pluginsDir });
    const main = await cli.run(["main"], { render: false });
    const notes = await cli.run(["notes", "search", "cats"], { render: false });
    const admin = await cli.run(["admin", "inspect"], { render: false });

    expect(installed.map((item) => item.name)).toEqual(["example"]);
    expect(main.result).toEqual({ app: "main" });
    expect(notes.result).toEqual({ query: "cats", source: "virtual" });
    expect(admin.result).toEqual({ status: "ok" });
  });

  test("does not import disabled virtual plugins", async () => {
    const pluginsDir = await createPluginsDir();
    await writePluginManifest(
      pluginsDir,
      "disabled",
      "duru.plugin.yml",
      `
        name: disabled
        entry: ./plugin.ts
        enabled: false
      `,
    );
    await writeFile(
      join(pluginsDir, "disabled", "plugin.ts"),
      `
        throw new Error("disabled plugin should not import");
      `,
    );

    const installed = await installVirtualPlugins(createCli(), { pluginsDir });

    expect(installed).toEqual([]);
  });

  test("rejects entry modules without virtualPlugin default exports", async () => {
    const pluginsDir = await createPluginsDir();
    await writePluginManifest(
      pluginsDir,
      "invalid",
      "duru.plugin.toml",
      `
        name = "invalid"
        entry = "./plugin.ts"
      `,
    );
    await writeFile(
      join(pluginsDir, "invalid", "plugin.ts"),
      `
        export default {};
      `,
    );

    await expect(installVirtualPlugins(createCli(), { pluginsDir })).rejects.toThrow(
      'Invalid virtual plugin export for "invalid": expected default export from virtualPlugin(...)',
    );
  });
});

async function createPluginsDir(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "duru-home-"));
  const pluginsDir = join(home, "plugins");
  await mkdir(pluginsDir, { recursive: true });
  return pluginsDir;
}

async function writePluginManifest(
  pluginsDir: string,
  pluginName: string,
  fileName: string,
  content: string,
): Promise<string> {
  const pluginDir = join(pluginsDir, pluginName);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, fileName), content);
  return pluginDir;
}

function coreModuleUrl(): string {
  return pathToFileURL(join(process.cwd(), "core/cli/src/index.ts")).href;
}

function virtualPluginsModuleUrl(): string {
  return pathToFileURL(join(process.cwd(), "packages/virtual-plugins/src/index.ts")).href;
}
