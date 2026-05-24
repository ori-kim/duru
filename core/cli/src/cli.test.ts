import { describe, expect, test } from "bun:test";
import {
  adaptResult,
  createCli,
  createPlugin,
  formatHelp,
  help,
  input,
  isHelpDocument,
  meta,
  parseOptionSpec,
  renderer,
  validationError,
} from "./index.ts";
import type { Renderer } from "./index.ts";

declare module "./types/help.ts" {
  interface CommandMetaFields {
    auth: { scope: string };
    shortcut: string;
  }
}

describe("createCli", () => {
  test("routes commands with params and options into actions", async () => {
    const cli = createCli().use(renderer(testRenderer()));

    cli
      .command("build <entry>", "Build project")
      .option("-w, --watch", "watch files")
      .action((ctx) => ({ entry: ctx.params.entry, watch: ctx.options.watch }));

    const result = await cli.run(["build", "src/index.ts", "--watch"]);

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ entry: "src/index.ts", watch: true });
    expect(result.value).toEqual({ entry: "src/index.ts", watch: true });
    expect(result.rendered?.stdout).toContain("src/index.ts");
  });

  test("rejects option specs without long option names", () => {
    expect(() => parseOptionSpec("json" as string)).toThrow(
      'Invalid option spec "json": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".',
    );
    expect(() => parseOptionSpec("-j" as string)).toThrow(
      'Invalid option spec "-j": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".',
    );
    expect(() => createCli().option("json" as string)).toThrow(
      'Invalid option spec "json": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".',
    );
    expect(() =>
      createCli()
        .command("run")
        .option("-d" as string),
    ).toThrow(
      'Invalid option spec "-d": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".',
    );
  });

  test("rejects input feature option definitions without long option aliases", () => {
    expect(() => {
      createCli().command(
        "run",
        input({
          options: [{ name: "dryRun", aliases: ["dry-run"], type: "boolean" }],
          parse() {
            return { options: {} };
          },
        }),
      );
    }).toThrow(
      'Invalid option definition "dryRun": option definitions must include a long alias starting with "--". Example: "--dry-run" or "-d, --dry-run".',
    );
  });

  test("runs middleware before command actions", async () => {
    const calls: string[] = [];
    const cli = createCli().use(renderer(testRenderer()));

    cli.use(async (ctx, next) => {
      calls.push("before");
      ctx.setService("message", "hello");
      const value = await next();
      calls.push("after");
      return value;
    });
    cli.command("hello").action((ctx) => {
      calls.push(ctx.service<string>("message") ?? "missing");
      return "done";
    });

    await cli.run(["hello"]);

    expect(calls).toEqual(["before", "hello", "after"]);
  });

  test("returns usage output for help", async () => {
    const cli = createCli({ name: "duru" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());
    cli.command("hello <name>", "Say hello").action(() => undefined);

    const result = await cli.run(["--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru <command>");
    expect(result.rendered?.stdout).toContain("hello <name>");
  });

  test("returns structured help documents before rendering", async () => {
    const cli = createCli({ name: "duru" }).use(help());
    cli.command("hello <name>", "Say hello").action(() => undefined);

    const result = await cli.run(["--help"], { render: false });

    expect(isHelpDocument(result.result)).toBe(true);
    expect(result.result).toMatchObject({
      name: "duru",
      routes: [{ pattern: "hello <name>", description: "Say hello" }],
    });
  });

  test("returns command metadata in structured help documents", async () => {
    const cli = createCli({ name: "duru" }).use(help());
    cli
      .command("call <operation>", "Call operation")
      .meta({
        aliases: ["invoke"],
        examples: [{ command: "duru call search", description: "Run search" }],
        usage: "call <operation> [--timeout-ms <ms>]",
        hidden: true,
        deprecated: true,
        group: "Operations",
      })
      .action(() => undefined);

    const result = await cli.run(["--help"], { render: false });

    expect(result.result).toMatchObject({
      routes: [
        {
          pattern: "call <operation>",
          aliases: ["invoke <operation>"],
          examples: [{ command: "duru call search", description: "Run search" }],
          usage: "call <operation> [--timeout-ms <ms>]",
          hidden: true,
          deprecated: true,
          group: "Operations",
        },
      ],
    });
  });

  test("accepts meta helper as command metadata config", async () => {
    const cli = createCli({ name: "duru" }).use(help());
    cli
      .command(
        "publish <name>",
        meta({
          description: "Run command metadata demo",
          aliases: ["pub <name>"],
          examples: ["duru publish notes"],
          usage: "publish <name> [--dry-run]",
          group: "Examples",
        }),
      )
      .option("--dry-run")
      .action((ctx) => ({ name: ctx.params.name, dryRun: ctx.options.dryRun ?? false }));

    const alias = await cli.run(["pub", "notes"], { render: false });
    const helpResult = await cli.run(["--help"], { render: false });

    expect(alias.result).toEqual({ name: "notes", dryRun: false });
    expect(helpResult.result).toMatchObject({
      routes: [
        {
          pattern: "publish <name>",
          description: "Run command metadata demo",
          aliases: ["pub <name>"],
          examples: ["duru publish notes"],
          usage: "publish <name> [--dry-run]",
          group: "Examples",
        },
      ],
    });
  });

  test("accepts meta helper with command input features", async () => {
    const cli = createCli({ name: "duru" }).use(help());
    cli
      .command(
        "call",
        input({
          params: [{ name: "operation", required: true }],
          parse(raw) {
            return { params: { operation: raw.params.operation } };
          },
        }),
        meta({
          description: "Run typed call",
          aliases: ["run <operation>"],
          examples: ["duru call sync"],
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation }));

    const alias = await cli.run(["run", "sync"], { render: false });
    const helpResult = await cli.run(["--help"], { render: false });

    expect(alias.result).toEqual({ operation: "sync" });
    expect(helpResult.result).toMatchObject({
      routes: [
        {
          pattern: "call <operation>",
          description: "Run typed call",
          aliases: ["run <operation>"],
          examples: ["duru call sync"],
        },
      ],
    });
  });

  test("routes commands through command aliases", async () => {
    const cli = createCli({ name: "duru" });
    cli
      .command("remove <name>", "Remove item")
      .alias("rm")
      .action((ctx) => ({ name: ctx.params.name, pattern: ctx.request.pattern }));

    const result = await cli.run(["rm", "example"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "example", pattern: "rm <name>" });
  });

  test("runs canonical cli path middleware for command aliases", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "duru" }).use("remove", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    cli
      .command("remove <name>")
      .alias("rm")
      .action(() => {
        calls.push("action");
        return undefined;
      });

    await cli.run(["rm", "example"], { render: false });

    expect(calls).toEqual(["scoped:before", "action", "scoped:after"]);
  });

  test("runs canonical child app path middleware for command aliases", async () => {
    const calls: string[] = [];
    const app = createCli().use("remove", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    app
      .command("remove <name>")
      .alias("rm")
      .action(() => {
        calls.push("action");
        return undefined;
      });

    await app.run(["rm", "example"], { render: false });

    expect(calls).toEqual(["scoped:before", "action", "scoped:after"]);
  });

  test("rejects command aliases that collide with existing command patterns", () => {
    const cli = createCli({ name: "duru" });
    cli.command("remove <name>").alias("rm");

    expect(() => cli.command("rm <name>")).toThrow("Duplicate command pattern: rm <name>");
    expect(() => cli.command("list <name>").alias("remove")).toThrow("Duplicate command pattern: remove <name>");
  });

  test("rejects command aliases with spacing issues before collision checks", () => {
    const cli = createCli({ name: "duru" });
    const spacedAlias: string = "  rm   ";
    cli.command("rm <name>");

    expect(() => cli.command("remove <name>").alias(spacedAlias)).toThrow("Invalid command alias");
  });

  test("rejects command aliases that do not follow command pattern grammar", async () => {
    const cli = createCli({ name: "duru" });
    const paramOnlyAlias: string = "<name>";
    const nestedLiteralAlias: string = "admin remove";
    const command = cli.command("remove <name>", "Remove item").alias("rm");

    expect(() => command.alias(paramOnlyAlias)).toThrow("Invalid command alias");
    expect(() => command.alias(nestedLiteralAlias)).toThrow("Invalid command alias");
    expect(() => command.meta({ aliases: [paramOnlyAlias] })).toThrow("Invalid command alias");
    expect(() =>
      cli.command("call", {
        aliases: ["<operation>"],
        input: input({
          params: [{ name: "operation", required: true }],
          parse(raw) {
            return { params: { operation: String(raw.params.operation) } };
          },
        }),
      }),
    ).toThrow("Invalid command alias");

    command.action((ctx) => ({ name: ctx.params.name }));

    const alias = await cli.run(["rm", "example"], { render: false });
    const rejected = await cli.run(["admin", "remove", "example"], { render: false });

    expect(alias.result).toEqual({ name: "example" });
    expect(rejected.ok).toBe(false);
  });

  test("does not partially apply rejected command aliases", async () => {
    const cli = createCli({ name: "duru" });
    const mismatchedAlias: string = "delete [name]";
    const command = cli.command("remove <name>", "Remove item").alias("rm");

    expect(() => command.alias(mismatchedAlias)).toThrow("Command alias params must match command params");
    command.action((ctx) => ({ name: ctx.params.name }));

    const alias = await cli.run(["rm", "example"], { render: false });
    const rejected = await cli.run(["delete", "example"], { render: false });

    expect(alias.result).toEqual({ name: "example" });
    expect(rejected.ok).toBe(false);
  });

  test("does not partially apply input features rejected by existing aliases", async () => {
    const cli = createCli({ name: "duru" });
    const command = cli.command("remove <name>", "Remove item").alias("rm <name>");

    expect(() =>
      command.input(
        input({
          params: [{ name: "force", required: true }],
          parse(raw) {
            return { params: { force: String(raw.params.force) } };
          },
        }),
      ),
    ).toThrow("Command alias params must match command params");
    command.action((ctx) => ({ name: ctx.params.name, pattern: ctx.request.pattern }));

    const canonical = await cli.run(["remove", "example"], { render: false });
    const alias = await cli.run(["rm", "example"], { render: false });

    expect(canonical.result).toEqual({ name: "example", pattern: "remove <name>" });
    expect(alias.result).toEqual({ name: "example", pattern: "rm <name>" });
  });

  test("includes command metadata in help while hiding hidden commands", async () => {
    const cli = createCli({ name: "duru" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());
    cli
      .command("call <operation>", "Call operation")
      .alias("invoke")
      .usage("call <operation> [--timeout-ms <ms>]")
      .example("duru call search")
      .deprecated("Use run instead")
      .group("Operations")
      .option("--timeout-ms <ms>", "Timeout")
      .action(() => undefined);
    cli
      .command("internal", "Internal command")
      .hidden()
      .action(() => undefined);

    const list = await cli.run(["--help"]);
    const command = await cli.run(["call", "--help"]);

    expect(list.rendered?.stdout).toContain("Operations:");
    expect(list.rendered?.stdout).toContain("call <operation>  Call operation deprecated: Use run instead");
    expect(list.rendered?.stdout).not.toContain("internal");
    expect(command.rendered?.stdout).toContain("Usage: duru call <operation> [--timeout-ms <ms>]");
    expect(command.rendered?.stdout).toContain("Aliases:");
    expect(command.rendered?.stdout).toContain("invoke <operation>");
    expect(command.rendered?.stdout).toContain("Examples:");
    expect(command.rendered?.stdout).toContain("duru call search");
  });

  test("shows namespace help when a dynamic route shares the namespace literal", async () => {
    const gateway = createCli();
    gateway.command("add <name>", "Add gateway target").action(() => undefined);

    const targetHelpRoute = createPlugin((api) => {
      api.helpRoutes(() => [
        {
          pattern: "gateway <target> [...args]",
          description: "Run a gateway target",
          options: [],
        },
      ]);
    });
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .subCommand("gateway", gateway)
      .use(targetHelpRoute)
      .use(help());

    const result = await cli.run(["gateway", "--help"]);
    const stdout = result.rendered?.stdout ?? "";

    expect(stdout).toContain("Usage: duru gateway <command>");
    expect(stdout).toContain("gateway add <name>  Add gateway target");
    expect(stdout).toContain("gateway <target> [...args]  Run a gateway target");
    expect(stdout).not.toContain("Usage: duru gateway <target> [...args]");
  });

  test("keeps usage overrides relative to routed app prefixes", async () => {
    const registry = createCli();
    registry
      .command("add <name>", "Add item")
      .usage("add <name> [--json]")
      .action(() => undefined);
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .use(help())
      .subCommand("registry", registry);

    const result = await cli.run(["registry", "add", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru registry add <name> [--json]");
  });

  test("does not prefix absolute routed usage overrides twice", async () => {
    const registry = createCli();
    registry
      .command("add <name>", "Add item")
      .usage("duru registry add <name> [--json]")
      .action(() => undefined);
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .use(help())
      .subCommand("registry", registry);

    const result = await cli.run(["registry", "add", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru registry add <name> [--json]");
    expect(result.rendered?.stdout).not.toContain("duru registry duru registry");
  });

  test("keeps routed usage prefixes when route and command literals repeat", async () => {
    const app = createCli();
    app
      .command("run <name>", "Run item")
      .usage("run <name> [--json]")
      .action(() => undefined);
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .use(help())
      .subCommand("run", app);

    const result = await cli.run(["run", "run", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru run run <name> [--json]");
  });

  test("accepts command metadata objects and command feature metadata", async () => {
    const callInput = input({
      params: [{ name: "operation", required: true }],
      metadata: {
        aliases: ["invoke"],
        examples: ["duru call search"],
      },
      parse(raw) {
        return { params: { operation: String(raw.params.operation) } };
      },
    });
    const cli = createCli({ name: "duru" }).use(help());
    cli
      .command("call", {
        input: callInput,
        description: "Call operation",
        usage: "call <operation>",
        group: "Operations",
      })
      .action((ctx) => ({ operation: ctx.params.operation }));

    const run = await cli.run(["invoke", "search"], { render: false });
    const helpResult = await cli.run(["--help"], { render: false });

    expect(run.result).toEqual({ operation: "search" });
    expect(helpResult.result).toMatchObject({
      routes: [
        {
          pattern: "call <operation>",
          description: "Call operation",
          aliases: ["invoke <operation>"],
          examples: ["duru call search"],
          usage: "call <operation>",
          group: "Operations",
        },
      ],
    });
  });

  test("composes extension command meta into matched routes", async () => {
    const calls: string[] = [];
    const auth = createPlugin((api) => {
      api.compose((command, next) => {
        const auth = command.meta.auth;
        if (auth) {
          command.use(async (ctx, next) => {
            calls.push(`auth:${auth.scope}:${ctx.meta.auth?.scope}`);
            return next();
          });
        }
        next();
      });
    });
    const cli = createCli().use(auth);

    cli
      .command("deploy")
      .meta({ auth: { scope: "deploy:write" } })
      .action((ctx) => {
        calls.push(`action:${ctx.meta.auth?.scope}`);
        return "deployed";
      });

    const result = await cli.run(["deploy"], { render: false });

    expect(result.result).toBe("deployed");
    expect(calls).toEqual(["auth:deploy:write:deploy:write", "action:deploy:write"]);
  });

  test("composes extension command aliases before routing", async () => {
    const shortcut = createPlugin((api) => {
      api.compose((command, next) => {
        if (command.meta.shortcut) command.alias(command.meta.shortcut);
        next();
      });
    });
    const cli = createCli().use(shortcut);

    cli
      .command("remove <name>")
      .meta({ shortcut: "rm" })
      .action((ctx) => ({ removed: ctx.params.name }));

    const result = await cli.run(["rm", "note"], { render: false });

    expect(result.result).toEqual({ removed: "note" });
  });

  test("composes extension command meta for routed child apps", async () => {
    const calls: string[] = [];
    const app = createCli();
    app
      .command("sync")
      .meta({ auth: { scope: "sync:write" } })
      .action(() => {
        calls.push("action");
        return "synced";
      });
    const auth = createPlugin((api) => {
      api.compose((command, next) => {
        const auth = command.meta.auth;
        if (auth) {
          command.use(async (_ctx, next) => {
            calls.push(`auth:${auth.scope}`);
            return next();
          });
        }
        next();
      });
    });
    const cli = createCli().subCommand("tools", app).use(auth);

    const result = await cli.run(["tools", "sync"], { render: false });

    expect(result.result).toBe("synced");
    expect(calls).toEqual(["auth:sync:write", "action"]);
  });

  test("command aliases are provided through the default composer", async () => {
    const cli = createCli();

    cli
      .command("inspect")
      .alias("i")
      .action(() => "inspected");

    const result = await cli.run(["i"], { render: false });

    expect(result.result).toBe("inspected");
  });

  test("does not run later command composers when one short-circuits", async () => {
    const calls: string[] = [];
    const first = createPlugin((api) => {
      api.compose(() => {
        calls.push("first");
      });
    });
    const second = createPlugin((api) => {
      api.compose((_command, next) => {
        calls.push("second");
        next();
      });
    });
    const cli = createCli().use(first).use(second);

    cli.command("run").action(() => "run");

    const result = await cli.run(["run"], { render: false });

    expect(result.result).toBe("run");
    expect(calls).toEqual(["first"]);
  });

  test("runs each command composer once per route", async () => {
    const calls: string[] = [];
    const plugin = createPlugin((api) => {
      api.compose((command, next) => {
        calls.push(command.pattern);
        next();
      });
    });
    const cli = createCli().use(plugin).use(help());

    cli.command("inspect").action(() => "inspected");

    await cli.run(["--help"], { render: false });
    await cli.run(["inspect"], { render: false });

    expect(calls).toEqual(["inspect"]);
  });

  test("applies default command alias composer to routed child apps", async () => {
    const app = createCli();
    app
      .command("sync")
      .alias("s")
      .action(() => "synced");
    const cli = createCli().subCommand("tools", app);

    const result = await cli.run(["tools", "s"], { render: false });

    expect(result.result).toBe("synced");
  });

  test("allows plugins to register commands through the plugin api", async () => {
    const plugin = createPlugin((api) => {
      api.command("inspect <name>").action((ctx) => ({ inspected: ctx.params.name }));
    });
    const cli = createCli().use(plugin);

    const result = await cli.run(["inspect", "test-service"], { render: false });

    expect(result.result).toEqual({ inspected: "test-service" });
  });

  test("allows externally composed child clis to be routed from plugins", async () => {
    const ext = createCli();
    ext.command("install <name>").action((ctx) => ({ installed: ctx.params.name }));
    ext.command("list").action(() => ({ items: ["test-service"] }));

    const plugin = createPlugin((api) => {
      api.subCommand("ext", ext);
    });
    const cli = createCli({ name: "duru" }).use(plugin).use(help());

    const install = await cli.run(["ext", "install", "test-service"], { render: false });
    const list = await cli.run(["ext", "list"], { render: false });
    const helpResult = await cli.run(["--help"], { render: false });

    expect(install.result).toEqual({ installed: "test-service" });
    expect(list.result).toEqual({ items: ["test-service"] });
    expect(helpResult.result).toMatchObject({
      name: "duru",
      routes: [{ pattern: "ext install <name>" }, { pattern: "ext list" }],
    });
  });

  test("combines usage output from routed child apps", async () => {
    const registry = createCli();
    registry.command("add <name>", "Add registry").action(() => undefined);
    const ext = createCli().subCommand("registry", registry);
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .use(help())
      .subCommand("ext", ext);

    const result = await cli.run(["--help"]);

    expect(result.rendered?.stdout.match(/Usage: duru <command>/g)).toHaveLength(1);
    expect(result.rendered?.stdout).toContain("ext registry add <name>");
  });

  test("routes standalone child apps through route", async () => {
    const app = createCli().option("--json");
    app.command("inspect", "Inspect app").action((ctx) => ({ json: ctx.options.json }));
    const cli = createCli({ name: "duru" }).use(renderer(testRenderer())).subCommand("tools", app);

    const result = await cli.run(["tools", "inspect", "--json"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ json: true });
  });

  test("routes child apps as command namespaces", async () => {
    const ext = createCli();
    ext.command("add <name>", "Add extension").action((ctx) => ({ added: ctx.params.name }));
    const cli = createCli({ name: "duru" }).use(renderer(testRenderer())).subCommand("ext", ext);

    const result = await cli.run(["ext", "add", "example"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ added: "example" });
  });

  test("routes child apps at explicit prefixes independent of app names", async () => {
    const target = createCli();
    target.command("tools", "List tools").action((ctx) => ({ pattern: ctx.request.pattern }));
    const cli = createCli({ name: "duru" }).use(renderer(testRenderer())).subCommand("target", target);

    const mounted = await cli.run(["target", "tools"]);
    const named = await cli.run(["target-tools", "tools"], { render: false });

    expect(mounted.ok).toBe(true);
    expect(mounted.value).toEqual({ pattern: "target tools" });
    expect(named.ok).toBe(false);
  });

  test("routes child cli apps at explicit prefixes", async () => {
    const target = createCli();
    target.command("tools").action((ctx) => ({ pattern: ctx.request.pattern }));
    const cli = createCli({ name: "duru" }).subCommand("target", target);

    const result = await cli.run(["target", "tools"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ pattern: "target tools" });
  });

  test("routes nested child cli apps at explicit prefixes", async () => {
    const registry = createCli();
    registry.command("add <name>").action((ctx) => ({ pattern: ctx.request.pattern, name: ctx.params.name }));
    const parent = createCli().subCommand("registry", registry);
    const cli = createCli({ name: "duru" }).subCommand("ext", parent);

    const result = await cli.run(["ext", "registry", "add", "example"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ pattern: "ext registry add <name>", name: "example" });
  });

  test("routes child apps inside child apps at explicit prefixes", async () => {
    const registry = createCli();
    registry.command("add <name>").action((ctx) => ({ pattern: ctx.request.pattern, name: ctx.params.name }));
    const parent = createCli().subCommand("registry", registry);
    const cli = createCli({ name: "duru" }).subCommand("ext", parent);

    const result = await cli.run(["ext", "registry", "add", "example"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ pattern: "ext registry add <name>", name: "example" });
  });

  test("shows explicit route prefixes in help", async () => {
    const target = createCli();
    target.command("tools", "List tools").action(() => undefined);
    const cli = createCli({ name: "duru" })
      .use(helpTextAdapter())
      .use(renderer(testRenderer()))
      .use(help())
      .subCommand("target", target);

    const result = await cli.run(["--help"]);

    expect(result.rendered?.stdout).toContain("target tools");
    expect(result.rendered?.stdout).not.toContain("target-tools tools");
  });

  test("runs path middleware against explicit route prefixes", async () => {
    const calls: string[] = [];
    const target = createCli();
    target.command("tools").action(() => {
      calls.push("action");
      return undefined;
    });
    const cli = createCli({ name: "duru" })
      .use("target", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("target", target);

    await cli.run(["target", "tools"], { render: false });

    expect(calls).toEqual(["scoped:before", "action", "scoped:after"]);
  });

  test("rejects empty and non-literal explicit route prefixes", () => {
    const app = createCli();

    // @ts-expect-error invalid literal route path
    expect(() => createCli().subCommand("", app)).toThrow("Route path cannot be empty");
    // @ts-expect-error invalid literal route path
    expect(() => createCli().subCommand("<tenant>", app)).toThrow("Route path must contain only literal tokens: <tenant>");
    // @ts-expect-error invalid literal route path
    expect(() => createCli().subCommand("target [scope]", app)).toThrow(
      "Route path must contain only literal tokens: [scope]",
    );
  });

  test("routes child apps inside child apps", async () => {
    const registry = createCli().option("--url <url>");
    registry.command("add <name>", "Add registry").action((ctx) => {
      return { name: ctx.params.name, pattern: ctx.request.pattern, url: ctx.options.url };
    });
    const ext = createCli().subCommand("registry", registry);
    const cli = createCli({ name: "duru" }).use(renderer(testRenderer())).subCommand("ext", ext);

    const result = await cli.run(["ext", "registry", "add", "example", "--url", "https://api.example.com"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      name: "example",
      pattern: "ext registry add <name>",
      url: "https://api.example.com",
    });
  });

  test("runs parent and child app middleware for nested routes", async () => {
    const calls: string[] = [];
    const child = createCli();
    child.use(async (_ctx, next) => {
      calls.push("child:before");
      await next();
      calls.push("child:after");
    });
    child.command("run").action(() => {
      calls.push("action");
      return undefined;
    });
    const parent = createCli();
    parent.use(async (_ctx, next) => {
      calls.push("parent:before");
      await next();
      calls.push("parent:after");
    });
    parent.subCommand("child", child);
    const cli = createCli({ name: "duru" }).subCommand("parent", parent);

    await cli.run(["parent", "child", "run"], { render: false });

    expect(calls).toEqual(["parent:before", "child:before", "action", "child:after", "parent:after"]);
  });

  test("keeps routed app options available to root commands", async () => {
    const registry = createCli().option("--url <url>");
    registry.command("add <name>").action(() => undefined);

    const ext = createCli().subCommand("registry", registry);
    const cli = createCli({ name: "duru" }).subCommand("ext", ext);
    cli.command("inspect").action((ctx) => ({ url: ctx.options.url }));

    const result = await cli.run(["inspect", "--url", "https://api.example.com"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ url: "https://api.example.com" });
  });

  test("runs later cli middleware around routed app commands", async () => {
    const calls: string[] = [];
    const ext = createCli();
    ext.command("run").action(() => {
      calls.push("action");
      return undefined;
    });

    const cli = createCli({ name: "duru" })
      .subCommand("ext", ext)
      .use(async (_ctx, next) => {
        calls.push("after-router:before");
        await next();
        calls.push("after-router:after");
      });

    await cli.run(["ext", "run"], { render: false });

    expect(calls).toEqual(["after-router:before", "action", "after-router:after"]);
  });

  test("runs cli path middleware only for matching command subtrees", async () => {
    const calls: string[] = [];
    const ext = createCli();
    ext.command("run").action(() => {
      calls.push("ext:run");
      return undefined;
    });

    const cli = createCli({ name: "duru" })
      .use("ext", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("ext", ext);

    cli.command("other").action(() => {
      calls.push("other");
      return undefined;
    });

    await cli.run(["ext", "run"], { render: false });
    await cli.run(["other"], { render: false });

    expect(calls).toEqual(["scoped:before", "ext:run", "scoped:after", "other"]);
  });

  test("runs cli path middleware when route options precede the command path", async () => {
    const calls: string[] = [];
    const ext = createCli();
    ext
      .command("run")
      .option("--mode <mode>")
      .action((ctx) => {
        calls.push(`run:${ctx.options.mode}`);
        return undefined;
      });

    const cli = createCli({ name: "duru" })
      .use("ext", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("ext", ext);

    await cli.run(["--mode", "fast", "ext", "run"], { render: false });

    expect(calls).toEqual(["scoped:before", "run:fast", "scoped:after"]);
  });

  test("runs cli path middleware using matched route options when aliases conflict", async () => {
    const calls: string[] = [];
    const other = createCli();
    other
      .command("run")
      .option("--mode")
      .action(() => undefined);

    const target = createCli();
    target
      .command("run")
      .option("--mode <mode>")
      .action((ctx) => {
        calls.push(`run:${ctx.options.mode}`);
        return undefined;
      });

    const cli = createCli({ name: "duru" })
      .use("target", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("other", other)
      .subCommand("target", target);

    await cli.run(["--mode", "fast", "target", "run"], { render: false });

    expect(calls).toEqual(["scoped:before", "run:fast", "scoped:after"]);
  });

  test("does not run cli path middleware for param values that match the scoped path", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "duru" }).use("target", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    cli.command("show <name>").action((ctx) => {
      calls.push(`name:${ctx.params.name}`);
      return undefined;
    });

    await cli.run(["show", "target"], { render: false });

    expect(calls).toEqual(["name:target"]);
  });

  test("matches cli path middleware against the selected route when later routes share literals", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "duru" }).use("target", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    cli.command("run <name>").action((ctx) => {
      calls.push(`param:${ctx.params.name}`);
      return undefined;
    });
    cli.command("target <name>").action(() => {
      calls.push("literal");
      return undefined;
    });

    await cli.run(["run", "target"], { render: false });

    expect(calls).toEqual(["param:target"]);
  });

  test("does not collapse params when matching cli path middleware prefixes", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "duru" }).use("run", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    cli.command("target <name>").action((ctx) => {
      calls.push(`param:${ctx.params.name}`);
      return undefined;
    });

    await cli.run(["target", "run"], { render: false });

    expect(calls).toEqual(["param:run"]);
  });

  test("matches cli path middleware using routed app order before default routes", async () => {
    const calls: string[] = [];
    const target = createCli();
    target.command("run").action(() => {
      calls.push("target:run");
      return undefined;
    });

    const cli = createCli({ name: "duru" })
      .use("target", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("target", target);
    cli.command("run <name>").action((ctx) => {
      calls.push(`param:${ctx.params.name}`);
      return undefined;
    });

    await cli.run(["target", "run"], { render: false });

    expect(calls).toEqual(["scoped:before", "target:run", "scoped:after"]);
  });

  test("does not let default route literals trigger cli path middleware for earlier app param routes", async () => {
    const calls: string[] = [];
    const app = createCli();
    app.command("show <name>").action((ctx) => {
      calls.push(`router:${ctx.params.name}`);
      return undefined;
    });

    const cli = createCli({ name: "duru" })
      .use("target", async (_ctx, next) => {
        calls.push("scoped:before");
        await next();
        calls.push("scoped:after");
      })
      .subCommand("tools", app);
    cli.command("target").action(() => {
      calls.push("literal");
      return undefined;
    });

    await cli.run(["tools", "show", "target"], { render: false });

    expect(calls).toEqual(["router:target"]);
  });

  test("runs app path middleware before matching child app middleware", async () => {
    const calls: string[] = [];
    const registry = createCli();
    registry.use(async (_ctx, next) => {
      calls.push("registry:before");
      await next();
      calls.push("registry:after");
    });
    registry.command("add <name>").action((ctx) => {
      calls.push(`add:${ctx.params.name}`);
      return undefined;
    });

    const ext = createCli();
    ext.use("registry", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    ext.subCommand("registry", registry);
    ext.command("list").action(() => {
      calls.push("list");
      return undefined;
    });

    const cli = createCli({ name: "duru" }).subCommand("ext", ext);

    await cli.run(["ext", "registry", "add", "example"], { render: false });
    await cli.run(["ext", "list"], { render: false });

    expect(calls).toEqual([
      "scoped:before",
      "registry:before",
      "add:example",
      "registry:after",
      "scoped:after",
      "list",
    ]);
  });

  test("runs multi-token app path middleware before matching child app middleware", async () => {
    const calls: string[] = [];
    const registry = createCli();
    registry.use(async (_ctx, next) => {
      calls.push("registry:before");
      await next();
      calls.push("registry:after");
    });
    registry.command("add <name>").action((ctx) => {
      calls.push(`add:${ctx.params.name}`);
      return undefined;
    });
    registry.command("list").action(() => {
      calls.push("registry:list");
      return undefined;
    });

    const ext = createCli();
    ext.use("registry add", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    ext.subCommand("registry", registry);

    const cli = createCli({ name: "duru" }).subCommand("ext", ext);

    await cli.run(["ext", "registry", "add", "example"], { render: false });
    await cli.run(["ext", "registry", "list"], { render: false });

    expect(calls).toEqual([
      "scoped:before",
      "registry:before",
      "add:example",
      "registry:after",
      "scoped:after",
      "registry:before",
      "registry:list",
      "registry:after",
    ]);
  });

  test("preserves app scoped middleware order relative to ordinary middleware", async () => {
    const calls: string[] = [];
    const app = createCli();
    app.use("run", async (_ctx, next) => {
      calls.push("scoped:before");
      await next();
      calls.push("scoped:after");
    });
    app.use(async (_ctx, next) => {
      calls.push("ordinary:before");
      await next();
      calls.push("ordinary:after");
    });
    app.command("run").action(() => {
      calls.push("action");
      return undefined;
    });
    app.command("skip").action(() => {
      calls.push("skip");
      return undefined;
    });

    const cli = createCli({ name: "duru" }).subCommand("tools", app);

    await cli.run(["tools", "run"], { render: false });
    await cli.run(["tools", "skip"], { render: false });

    expect(calls).toEqual([
      "ordinary:before",
      "scoped:before",
      "action",
      "scoped:after",
      "ordinary:after",
      "ordinary:before",
      "skip",
      "ordinary:after",
    ]);
  });

  test("rejects invalid command patterns at registration time", () => {
    for (const pattern of [" run <name>", "<run>", "run name <name>"]) {
      const value: string = pattern;
      expect(() => createCli().command(value)).toThrow("Invalid command pattern");
    }
  });

  test("rejects invalid scoped middleware paths at registration time", () => {
    const middleware = async (_ctx: never, next: () => unknown) => next();

    for (const path of ["", " run", "<run>", "run <name>"]) {
      const value: string = path;
      expect(() => createCli().use(value, middleware as never)).toThrow("Invalid middleware path");
    }
  });

  test("derives command params and options from input features before actions", async () => {
    const cli = createCli({ name: "duru" });

    cli
      .command(
        "call",
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse(raw) {
            return {
              params: { operation: String(raw.params.operation).toUpperCase() },
              options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) },
            };
          },
        }),
      )
      .action((ctx) => ({
        operation: ctx.params.operation,
        timeoutMs: ctx.options.timeoutMs,
        rawOperation: ctx.raw.params.operation,
        rawTimeoutMs: ctx.raw.options.timeoutMs,
      }));

    const result = await cli.run(["call", "list", "--timeout-ms", "2500"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      operation: "LIST",
      timeoutMs: 2500,
      rawOperation: "list",
      rawTimeoutMs: "2500",
    });
  });

  test("preserves raw command input when parsers mutate their local input", async () => {
    const cli = createCli({ name: "duru" });

    cli
      .command(
        "call",
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse(raw) {
            const mutableRaw = raw as {
              params: Record<string, unknown>;
              options: Record<string, unknown>;
            };
            mutableRaw.params.operation = "mutated";
            mutableRaw.options.timeoutMs = "9999";
            return {
              params: { operation: String(raw.params.operation).toUpperCase() },
              options: { timeoutMs: Number(raw.options.timeoutMs) },
            };
          },
        }),
      )
      .action((ctx) => ({
        operation: ctx.params.operation,
        timeoutMs: ctx.options.timeoutMs,
        rawOperation: ctx.raw.params.operation,
        rawTimeoutMs: ctx.raw.options.timeoutMs,
      }));

    const result = await cli.run(["call", "list", "--timeout-ms", "2500"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({
      operation: "MUTATED",
      timeoutMs: 9999,
      rawOperation: "list",
      rawTimeoutMs: "2500",
    });
  });

  test("supports builder input features as an equivalent command form", async () => {
    const cli = createCli({ name: "duru" });

    cli
      .command("call")
      .input(
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse(raw) {
            return {
              params: { operation: String(raw.params.operation) },
              options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) },
            };
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation, timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call", "list"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ operation: "list", timeoutMs: 30000 });
  });

  test("composes multiple command input features", async () => {
    const operationInput = input({
      params: [{ name: "operation", required: true }],
      parse(raw) {
        return { params: { operation: String(raw.params.operation) } };
      },
    });
    const timeoutInput = input({
      options: [parseOptionSpec("--timeout-ms <ms>")],
      parse(raw) {
        return { options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) } };
      },
    });
    const cli = createCli({ name: "duru" });

    cli
      .command("call")
      .input(operationInput)
      .input(timeoutInput)
      .action((ctx) => ({ operation: ctx.params.operation, timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call", "list", "--timeout-ms", "2500"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ operation: "list", timeoutMs: 2500 });
  });

  test("uses input feature params and options in command help", async () => {
    const cli = createCli({ name: "duru" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());

    cli
      .command(
        "call",
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>", "Timeout in milliseconds")],
          parse(raw) {
            return {
              params: { operation: String(raw.params.operation) },
              options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) },
            };
          },
        }),
      )
      .action(() => undefined);

    const result = await cli.run(["call", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru call <operation>");
    expect(result.rendered?.stdout).toContain("--timeout-ms");
    expect(result.rendered?.stdout).toContain("Timeout in milliseconds");
  });

  test("rejects duplicate input params and command pattern params at registration", () => {
    expect(() => {
      createCli().command(
        "call <operation>",
        input({
          params: [{ name: "operation", required: true }],
          parse(raw) {
            return { params: { operation: String(raw.params.operation) } };
          },
        }),
      );
    }).toThrow("Duplicate command input param: operation");
  });

  test("rejects duplicate input options and command options at registration", () => {
    expect(() => {
      createCli()
        .command(
          "call",
          input({
            options: [parseOptionSpec("--timeout-ms <ms>")],
            parse(raw) {
              return { options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) } };
            },
          }),
        )
        .option("--timeout-ms <ms>");
    }).toThrow("Duplicate command option: timeoutMs");
  });

  test("rejects duplicate command options before builder input features", () => {
    expect(() => {
      createCli()
        .command("call")
        .option("--timeout-ms <ms>")
        .input(
          input({
            options: [parseOptionSpec("--timeout-ms <ms>")],
            parse(raw) {
              return { options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) } };
            },
          }),
        );
    }).toThrow("Duplicate command option: timeoutMs");
  });

  test("does not partially apply rejected builder input features", async () => {
    const cli = createCli({ name: "duru" });
    const command = cli.command("call").option("--timeout-ms <ms>");

    expect(() => {
      command.input(
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse(raw) {
            return {
              params: { operation: String(raw.params.operation) },
              options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) },
            };
          },
        }),
      );
    }).toThrow("Duplicate command option: timeoutMs");

    command.action((ctx) => ({ timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call", "--timeout-ms", "2500"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ timeoutMs: "2500" });
  });

  test("keeps raw matched command context available when input parsing fails", async () => {
    const cli = createCli({ name: "duru" });
    cli.catch((ctx) =>
      ctx.exit(2, {
        message: (ctx.error as Error).message,
        pattern: ctx.request.pattern,
        rawPattern: ctx.raw.pattern,
        rawParams: ctx.raw.params,
        rawOptions: ctx.raw.options,
      }),
    );

    cli
      .command(
        "call",
        input({
          params: [{ name: "operation", required: true }],
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse() {
            throw new Error("invalid input");
          },
        }),
      )
      .action(() => undefined);

    const result = await cli.run(["call", "list", "--timeout-ms", "2500"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({
      message: "invalid input",
      pattern: "call <operation>",
      rawPattern: "call <operation>",
      rawParams: { operation: "list" },
      rawOptions: { timeoutMs: "2500" },
    });
  });

  test("collects unknown events emitted by actions", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.command("run").action((ctx) => {
      ctx.emit("log", { message: "started" });
      return { ok: true };
    });

    const result = await cli.run(["run"]);

    expect(result.events).toEqual([{ name: "log", payload: { message: "started" } }]);
    expect(result.value).toEqual({ ok: true });
  });

  test("notifies event observers from action contexts", async () => {
    const seen: unknown[] = [];
    const cli = createCli().use(renderer(testRenderer()));
    cli.on("log", (ctx) => {
      seen.push(ctx.event.payload);
    });
    cli.command("run").action(async (ctx) => {
      await ctx.emit("log", { message: "started" });
      return { ok: true };
    });

    await cli.run(["run"]);

    expect(seen).toEqual([{ message: "started" }]);
  });

  test("allows app-level custom event emission", async () => {
    const seen: unknown[] = [];
    const cli = createCli();
    cli.on("custom", (ctx) => {
      seen.push(ctx.event.payload);
    });

    await cli.emit("custom", { value: 1 });

    expect(seen).toEqual([{ value: 1 }]);
  });

  test("returns programmatic results without a registered renderer", async () => {
    const cli = createCli();
    cli.command("hello").action(() => ({ greeting: "hello" }));

    const result = await cli.run(["hello"]);

    expect(result.value).toEqual({ greeting: "hello" });
    expect(result.rendered).toBeUndefined();
  });

  test("allows notFound handlers to override exit results", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.notFound((ctx) => ctx.exit(2, { missing: ctx.argv.join(" ") }));

    const result = await cli.run(["missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ missing: "missing" });
  });

  test("allows root catch handlers to override thrown action errors", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.catch((ctx) => ctx.exit(7, { message: (ctx.error as Error).message }));
    cli.command("boom").action(() => {
      throw new Error("failed");
    });

    const result = await cli.run(["boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.result).toEqual({ message: "failed" });
  });

  test("allows root catch handlers to override root middleware errors", async () => {
    const cli = createCli()
      .catch((ctx) => ctx.exit(6, { message: (ctx.error as Error).message }))
      .use(() => {
        throw new Error("middleware failed");
      });
    cli.command("run").action(() => ({ reached: true }));

    const result = await cli.run(["run"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(6);
    expect(result.result).toEqual({ message: "middleware failed" });
  });

  test("lets cli middleware catch action errors before root catch handlers", async () => {
    const calls: string[] = [];
    const cli = createCli()
      .use(async (ctx, next) => {
        try {
          return await next();
        } catch (error) {
          calls.push("middleware");
          return ctx.exit(5, { handledBy: "middleware", message: (error as Error).message });
        }
      })
      .catch((ctx) => {
        calls.push("root");
        return ctx.exit(6, { handledBy: "root", message: (ctx.error as Error).message });
      });
    cli.command("boom").action(() => {
      throw new Error("failed");
    });

    const result = await cli.run(["boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.result).toEqual({ handledBy: "middleware", message: "failed" });
    expect(calls).toEqual(["middleware"]);
  });

  test("allows command catch handlers to override action errors before root handlers", async () => {
    const calls: string[] = [];
    const cli = createCli();
    cli.catch(() => {
      calls.push("root");
      return { reached: "root" };
    });
    cli
      .command("boom")
      .catch((ctx) => {
        calls.push("command");
        return ctx.exit(8, { message: (ctx.error as Error).message, pattern: ctx.request.pattern });
      })
      .action(() => {
        throw new Error("failed");
      });

    const result = await cli.run(["boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(8);
    expect(result.result).toEqual({ message: "failed", pattern: "boom" });
    expect(calls).toEqual(["command"]);
  });

  test("allows nearest routed app error boundaries to handle command errors", async () => {
    const calls: string[] = [];
    const parent = createCli().use(async (ctx, next) => {
      try {
        return await next();
      } catch (error) {
        calls.push("parent");
        return ctx.exit(6, { handledBy: "parent", message: (error as Error).message });
      }
    });
    const child = createCli().use(async (ctx, next) => {
      try {
        return await next();
      } catch (error) {
        calls.push("child");
        return ctx.exit(5, { handledBy: "child", message: (error as Error).message });
      }
    });
    child.command("boom").action(() => {
      throw new Error("failed");
    });
    parent.subCommand("child", child);

    const result = await createCli().subCommand("parent", parent).run(["parent", "child", "boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.result).toEqual({ handledBy: "child", message: "failed" });
    expect(calls).toEqual(["child"]);
  });

  test("uses nearest routed app catch handlers for child app middleware errors", async () => {
    const calls: string[] = [];
    const parent = createCli().catch((ctx) => {
      calls.push("parent");
      return ctx.exit(6, { handledBy: "parent", message: (ctx.error as Error).message });
    });
    const child = createCli()
      .catch((ctx) => {
        calls.push("child");
        return ctx.exit(5, { handledBy: "child", message: (ctx.error as Error).message });
      })
      .use(() => {
        throw new Error("child middleware failed");
      });
    child.command("run").action(() => ({ reached: true }));
    parent.subCommand("child", child);

    const result = await parent.run(["child", "run"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.result).toEqual({ handledBy: "child", message: "child middleware failed" });
    expect(calls).toEqual(["child"]);
  });

  test("falls back from routed app error boundaries to root catch handlers", async () => {
    const calls: string[] = [];
    const app = createCli().use(async (_ctx, next) => {
      try {
        return await next();
      } catch (error) {
        calls.push("app");
        throw error;
      }
    });
    app.command("boom").action(() => {
      throw new Error("failed");
    });
    const cli = createCli().subCommand("app", app);
    cli.catch((ctx) => {
      calls.push("root");
      return ctx.exit(9, { message: (ctx.error as Error).message });
    });

    const result = await cli.run(["app", "boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(9);
    expect(result.result).toEqual({ message: "failed" });
    expect(calls).toEqual(["app", "root"]);
  });

  test("allows command catch handlers to override validation errors", async () => {
    const cli = createCli();
    cli
      .command(
        "call",
        input({
          parse() {
            throw validationError("input", [{ path: ["token"], code: "required", message: "Missing token" }]);
          },
        }),
      )
      .catch((ctx) => ctx.exit(4, { kind: (ctx.error as { kind?: string }).kind }))
      .action(() => ({ reached: true }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(4);
    expect(result.result).toEqual({ kind: "duru.validation_error" });
  });

  test("keeps validation failure status when local boundaries return the validation error", async () => {
    const cli = createCli();
    cli
      .command(
        "call",
        input({
          parse() {
            throw validationError("input", [{ path: ["token"], code: "required", message: "Missing token" }]);
          },
        }),
      )
      .catch((ctx) => ctx.error)
      .action(() => ({ reached: true }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toMatchObject({ kind: "duru.validation_error" });
  });

  test("keeps failure status when local boundaries return plain objects", async () => {
    const cli = createCli();
    cli
      .command("boom")
      .catch((ctx) => ({ message: (ctx.error as Error).message }))
      .action(() => {
        throw new Error("failed");
      });

    const result = await cli.run(["boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({ message: "failed" });
  });

  test("does not render handled errors through action presenters", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("boom")
      .catch((ctx) => ctx.exit(1, { message: (ctx.error as Error).message }))
      .action((): { status: string } => {
        throw new Error("failed");
      })
      .text((result) => result.status.toUpperCase());

    const result = await cli.run(["boom"], { renderer: "text", render: false });

    expect(result.ok).toBe(false);
    expect(result.value).toEqual({ message: "failed" });
  });

  test("does not let command catch handlers swallow parent app middleware errors", async () => {
    const calls: string[] = [];
    const parent = createCli()
      .use(async (ctx, next) => {
        try {
          return await next();
        } catch (error) {
          calls.push("parent");
          return ctx.exit(5, { message: (error as Error).message });
        }
      })
      .use(() => {
        throw new Error("auth failed");
      });
    const child = createCli();
    child
      .command("run")
      .catch(() => {
        calls.push("command");
        return { handled: "command" };
      })
      .action(() => ({ reached: true }));
    parent.subCommand("child", child);

    const result = await createCli().subCommand("parent", parent).run(["parent", "child", "run"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.result).toEqual({ message: "auth failed" });
    expect(calls).toEqual(["parent"]);
  });

  test("uses nearest app boundary for child app middleware errors", async () => {
    const calls: string[] = [];
    const parent = createCli().use(async (ctx, next) => {
      try {
        return await next();
      } catch (error) {
        calls.push("parent");
        return ctx.exit(6, { handledBy: "parent", message: (error as Error).message });
      }
    });
    const child = createCli()
      .use(async (ctx, next) => {
        try {
          return await next();
        } catch (error) {
          calls.push("child");
          return ctx.exit(5, { handledBy: "child", message: (error as Error).message });
        }
      })
      .use(() => {
        throw new Error("child middleware failed");
      });
    child.command("run").action(() => ({ reached: true }));
    parent.subCommand("child", child);

    const result = await createCli().subCommand("parent", parent).run(["parent", "child", "run"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(5);
    expect(result.result).toEqual({ handledBy: "child", message: "child middleware failed" });
    expect(calls).toEqual(["child"]);
  });

  test("returns command-level help with route options", async () => {
    const cli = createCli({ name: "duru" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());
    cli
      .command("hello <name>", "Say hello")
      .option("-u, --uppercase", "Uppercase output")
      .action(() => undefined);

    const result = await cli.run(["hello", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: duru hello <name>");
    expect(result.rendered?.stdout).toContain("-u, --uppercase");
  });

  test("uses format presenters for action return values", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("build <entry>")
      .action((ctx) => ({ entry: ctx.params.entry, status: "ok" }))
      .render("test", (result) => `${result.status}: ${result.entry}`);

    const result = await cli.run(["build", "src/index.ts"]);

    expect(result.value).toBe("ok: src/index.ts");
    expect(result.rendered?.stdout).toBe('"ok: src/index.ts"\n');
  });

  test("supports text and json presenter shortcuts", async () => {
    const cli = createCli()
      .use(renderer(testRenderer("text"), testRenderer("json")))
      .use(jsonModePlugin());
    cli
      .command("hello <name>")
      .action((ctx) => ({ greeting: `hello ${ctx.params.name}` }))
      .text((result) => result.greeting)
      .json((result) => result);

    const text = await cli.run(["hello", "example"]);
    const json = await cli.run(["hello", "example", "--json"]);

    expect(text.value).toBe("hello example");
    expect(json.value).toEqual({ greeting: "hello example" });
  });

  test("includes emitted events in json rendering when requested", async () => {
    const cli = createCli()
      .option("--events")
      .use(renderer(testRenderer("json")));
    cli.command("run").action((ctx) => {
      ctx.emit("log", { message: "started" });
      return { ok: true };
    });

    const result = await cli.run(["run", "--events"]);

    expect(result.value).toEqual({ ok: true });
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({
      result: { ok: true },
      events: [{ name: "log", payload: { message: "started" } }],
    });
  });

  test("renders action return values through command render handlers", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("build <entry>")
      .action((ctx) => ({ entry: ctx.params.entry, status: "ok" }))
      .render("test", (result) => `${result.status}: ${result.entry}`);

    const result = await cli.run(["build", "src/index.ts"]);

    expect(result.value).toBe("ok: src/index.ts");
  });
});

function testRenderer(id = "test"): Renderer {
  return {
    id,
    render(input, ctx) {
      const value = ctx.options.events ? { result: input.value, events: input.events } : input.value;
      return {
        stdout: `${JSON.stringify(value)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

function jsonModePlugin() {
  return createPlugin<{ json?: boolean }>((api) => {
    api.option(parseOptionSpec("--json"));
    api.selectRenderer((ctx) => (ctx.options.json ? "json" : undefined));
  });
}

function helpTextAdapter() {
  return adaptResult({
    match: isHelpDocument,
    adapt: formatHelp,
  });
}
