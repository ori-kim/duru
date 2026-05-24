import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCli } from "@duru/cli-kit";
import {
  installVirtualPlugins,
  isVirtualPlugin,
  loadPluginManifest,
  virtualPlugin,
} from "@duru/virtual-plugins";

async function createHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "duru-home-"));
  await mkdir(join(home, "plugins"), { recursive: true });
  return home;
}

async function writeManifest(home: string, content: string): Promise<void> {
  await writeFile(join(home, "plugins", "plugins.yml"), content, "utf8");
}

async function writePlugin(pluginDir: string, fileName: string, content: string): Promise<void> {
  await mkdir(pluginDir, { recursive: true });
  await writeFile(join(pluginDir, fileName), content, "utf8");
}

function coreModuleUrl(): string {
  return pathToFileURL(join(process.cwd(), "core/cli/src/index.ts")).href;
}

function vpModuleUrl(): string {
  return pathToFileURL(join(process.cwd(), "packages/virtual-plugins/src/index.ts")).href;
}

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

  test("loads plugins from plugins.yml sorted by order then name", async () => {
    const home = await createHome();
    const p1 = join(home, "plugins", "alpha");
    const p2 = join(home, "plugins", "beta");
    const p3 = join(home, "plugins", "skip");
    await writeManifest(home, `
plugins:
  - name: beta
    path: ${p2}
    entry: plugin.ts
    order: 200
  - name: alpha
    path: ${p1}
    entry: plugin.ts
    order: 100
  - name: skip
    path: ${p3}
    entry: plugin.ts
    enabled: false
    order: 1
`);
    const plugins = await loadPluginManifest({ home });
    expect(plugins.map((p: { name: string }) => p.name)).toEqual(["alpha", "beta"]);
    expect(plugins.map((p: { order: number }) => p.order)).toEqual([100, 200]);
    expect(plugins[0]?.enabled).toBe(true);
  });

  test("returns empty list when plugins.yml is missing", async () => {
    const home = await createHome();
    const plugins = await loadPluginManifest({ home });
    expect(plugins).toEqual([]);
  });

  test("installs virtual plugin middleware and multiple routes", async () => {
    const home = await createHome();
    const pluginDir = join(home, "plugins", "example");
    await writeManifest(home, `
plugins:
  - name: example
    path: ${pluginDir}
    entry: plugin.ts
    contributes:
      commands:
        - notes
        - admin
`);
    await writePlugin(pluginDir, "plugin.ts", `
      import { createCli, createPlugin } from "${coreModuleUrl()}";
      import { virtualPlugin } from "${vpModuleUrl()}";
      export default virtualPlugin((cli) => {
        cli.use(createPlugin((api) => {
          api.middleware(async (ctx, next) => {
            ctx.setService("source", "virtual");
            return next();
          });
        }));
        const notes = createCli();
        notes.command("search <query>").action((ctx) => ({ query: ctx.params.query, source: ctx.service("source") }));
        const admin = createCli();
        admin.command("inspect").action(() => ({ status: "ok" }));
        cli.subCommand("notes", notes);
        cli.subCommand("admin", admin);
      });
    `);
    const cli = createCli();
    cli.command("main").action(() => ({ app: "main" }));
    const loader = await installVirtualPlugins(cli, { home });
    const main = await cli.run(["main"], { render: false });
    const notes = await cli.run(["notes", "search", "cats"], { render: false });
    const admin = await cli.run(["admin", "inspect"], { render: false });
    expect(loader.phase1Plugins.map((p: { name: string }) => p.name)).toEqual(["example"]);
    expect(loader.phase1Commands).toEqual(new Set(["notes", "admin"]));
    expect(main.result).toEqual({ app: "main" });
    expect(notes.result).toEqual({ query: "cats", source: "virtual" });
    expect(admin.result).toEqual({ status: "ok" });
  });

  test("skips plugin import when argv does not match contributes.commands", async () => {
    const home = await createHome();
    const pluginDir = join(home, "plugins", "lazy");
    await writeManifest(home, `
plugins:
  - name: lazy
    path: ${pluginDir}
    entry: plugin.ts
    contributes:
      commands:
        - lazy-cmd
`);
    await writePlugin(pluginDir, "plugin.ts", `
      import { virtualPlugin } from "${vpModuleUrl()}";
      export default virtualPlugin((cli) => {
        cli.command("lazy-cmd").action(() => ({ lazy: true }));
      });
    `);
    const cli = createCli();
    const loader = await installVirtualPlugins(cli, { home }, ["other-cmd"]);
    expect(loader.phase1Plugins.map((p: { name: string }) => p.name)).toEqual(["lazy"]);
    expect(loader.phase1Commands).toEqual(new Set(["lazy-cmd"]));
    expect(loader.phase1Plugins[0]?.initialized).toBe(false);
  });

  test("eager plugin is always imported regardless of argv", async () => {
    const home = await createHome();
    const pluginDir = join(home, "plugins", "capture");
    await writeManifest(home, `
plugins:
  - name: capture
    path: ${pluginDir}
    entry: plugin.ts
    contributes:
      commands:
        - capture
      eager: true
`);
    await writePlugin(pluginDir, "plugin.ts", `
      import { virtualPlugin } from "${vpModuleUrl()}";
      export default virtualPlugin((cli) => {
        cli.command("capture").action(() => ({ captured: true }));
      });
    `);
    const cli = createCli();
    const loader = await installVirtualPlugins(cli, { home }, ["unrelated-cmd"]);
    expect(loader.phase1Plugins[0]?.initialized).toBe(true);
  });

  test("does not import disabled plugins", async () => {
    const home = await createHome();
    const pluginDir = join(home, "plugins", "disabled");
    await writeManifest(home, `
plugins:
  - name: disabled
    path: ${pluginDir}
    entry: plugin.ts
    enabled: false
`);
    await writePlugin(pluginDir, "plugin.ts", `throw new Error("disabled plugin should not import");`);
    const loader = await installVirtualPlugins(createCli(), { home });
    expect(loader.phase1Plugins).toEqual([]);
  });

  test("manifestPath option overrides home-based path", async () => {
    const home = await createHome();
    const pluginDir = join(home, "plugins", "custom");
    const manifestPath = join(home, "custom-plugins.yml");
    await writeFile(manifestPath, `
plugins:
  - name: custom
    path: ${pluginDir}
    entry: plugin.ts
    contributes:
      commands:
        - custom
`, "utf8");
    await writePlugin(pluginDir, "plugin.ts", `
      import { virtualPlugin } from "${vpModuleUrl()}";
      export default virtualPlugin((cli) => {
        cli.command("custom").action(() => ({ custom: true }));
      });
    `);
    const cli = createCli();
    const loader = await installVirtualPlugins(cli, { manifestPath });
    const result = await cli.run(["custom"], { render: false });
    expect(loader.phase1Plugins.map((p: { name: string }) => p.name)).toEqual(["custom"]);
    expect(result.result).toEqual({ custom: true });
  });
});
