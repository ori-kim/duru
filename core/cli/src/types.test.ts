import { describe, test } from "bun:test";
import { createCli as createPublicCli, createPlugin as createPublicPlugin } from "@duru/cli-kit";
import type { CommandMeta as PublicCommandMeta } from "@duru/cli-kit";
import { context, createCli, createPlugin, help, input, meta, parseOptionSpec } from "./index.ts";
import type {
  CommandConfig,
  CommandMeta,
  CommandPattern,
  Middleware,
  MiddlewarePath,
  OptionSpec,
  OptionSpecOptions,
  OptionValue,
  Params,
  PatternParams,
  RouteErrorHandler,
} from "./index.ts";

declare module "./types/help.ts" {
  interface CommandMetaFields {
    auth: { scope: string };
    shortcut: string;
  }
}

declare module "@duru/cli-kit" {
  interface CommandMetaFields {
    publicAuth: { scope: string };
  }
}

type Equal<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _PatternParams = Expect<
  Equal<PatternParams<"build <entry> [mode] [...args]">, { entry: string; mode?: string; args: string[] }>
>;
type _InvalidSpacedCommandPattern = Expect<
  Equal<
    CommandPattern<" inspect">,
    'Invalid command pattern " inspect": remove leading, trailing, or repeated spaces. Example: "run <name> [...args]".'
  >
>;
type _InvalidSubcommandPattern = Expect<
  Equal<
    CommandPattern<"metadata publish <name>">,
    'Invalid command pattern "metadata publish <name>": after the command name, only params like <name>, [name], <...args>, or [...args] are allowed. Extra literal subcommands are not allowed.'
  >
>;
type _InvalidMiddlewarePath = Expect<
  Equal<
    MiddlewarePath<"run <name>">,
    'Invalid middleware path "run <name>": only literal command path tokens are allowed; params like <name> or [name] are not allowed.'
  >
>;
type _BooleanOption = Expect<Equal<OptionSpecOptions<"-w, --watch">, { watch?: boolean }>>;
type _ValueOption = Expect<Equal<OptionSpecOptions<"--timeout-ms <ms>">, { timeoutMs?: string }>>;
type _NegatedOption = Expect<Equal<OptionSpecOptions<"--no-color">, { color?: boolean }>>;
type _InvalidBareOption = Expect<
  Equal<
    OptionSpec<"json">,
    'Invalid option spec "json": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".'
  >
>;
type _InvalidShortOnlyOption = Expect<
  Equal<
    OptionSpec<"-j">,
    'Invalid option spec "-j": option specs must include a long option starting with "--". Example: "--json" or "-j, --json".'
  >
>;
type _PublicOptionValue = Expect<Equal<OptionValue, boolean | string | string[]>>;
type _PublicParams = Expect<Equal<Params, Record<string, string | string[] | undefined>>>;

function assertPublicPathGrammarTypes() {
  const cli = createCli();
  const middleware = (_ctx: never, next: () => unknown) => next();
  const widenedPattern: string = " run";
  const widenedPath: string = " run";

  cli.command("run");
  cli.command("run <name>");
  cli.command("run <name> [...args]");
  cli.command("run <name>").alias("execute");
  cli.command("run <name>").alias("execute <name>");
  cli.command("run <name>").aliases("execute", "execute <name>");
  cli.command(widenedPattern);
  cli.option("--json");
  cli.option("-j, --json");
  cli.command("run").option("--dry-run");
  cli.command("run").option("-d, --dry-run");
  cli.use("run", middleware as never);
  cli.use("run child", middleware as never);
  cli.use(widenedPath, middleware as never);

  // @ts-expect-error Command patterns cannot have whitespace padding.
  cli.command(" run <name>");
  // @ts-expect-error Command patterns must start with a literal subcommand.
  cli.command("<run>");
  // @ts-expect-error Command patterns cannot include literal tokens after the subcommand.
  cli.command("run name <name>");
  // @ts-expect-error Command aliases must start with a literal subcommand.
  cli.command("run <name>").alias("<name>");
  // @ts-expect-error Command aliases cannot include literal tokens after the subcommand.
  cli.command("run <name>").alias("admin run");
  // @ts-expect-error Command aliases with explicit params must match the command params.
  cli.command("run <name>").alias("execute [name]");
  // @ts-expect-error Options must include a long --name alias.
  cli.option("json");
  // @ts-expect-error Short options are only aliases and cannot be the only option name.
  cli.option("-j");
  // @ts-expect-error Command options must include a long --name alias.
  cli.command("run").option("dry-run");
  // @ts-expect-error Command short options need a long --name alias.
  cli.command("run").option("-d");
  // @ts-expect-error Middleware paths cannot be empty.
  cli.use("", middleware as never);
  // @ts-expect-error Middleware paths cannot have whitespace padding.
  cli.use(" run", middleware as never);
  // @ts-expect-error Middleware paths cannot include params.
  cli.use("<run>", middleware as never);
  // @ts-expect-error Middleware paths cannot include params.
  cli.use("run <name>", middleware as never);
}

void assertPublicPathGrammarTypes;

describe("public type inference", () => {
  test("infers action params, options, and context from fluent declarations", () => {
    createCli()
      .option("--json")
      .command("build <entry> [...args]")
      .alias("bundle")
      .usage("build <entry> [...args] [--watch]")
      .example("cli build src/index.ts")
      .deprecated("Use compile instead")
      .group("Build")
      .option("-w, --watch")
      .option("--timeout-ms <ms>")
      .action((ctx) => {
        const typedEntry: string = ctx.params.entry;
        const typedArgs: string[] = ctx.params.args;
        const typedJson: boolean | undefined = ctx.options.json;
        const typedWatch: boolean | undefined = ctx.options.watch;
        const typedTimeout: string | undefined = ctx.options.timeoutMs;
        const typedParam: string = ctx.params.entry;

        return { typedEntry, typedArgs, typedJson, typedWatch, typedTimeout, typedParam };
      });
  });

  test("carries option types installed by use plugins into commands", () => {
    createCli()
      .use(rendererOptionsPlugin())
      .command("inspect")
      .action((ctx) => {
        const typedJson: boolean | undefined = ctx.options.json;
        const typedEvents: boolean | undefined = ctx.options.events;
        const typedCtxJson: boolean | undefined = ctx.options.json;
        const typedCtxEvents: boolean | undefined = ctx.options.events;
        return { typedJson, typedEvents, typedCtxJson, typedCtxEvents };
      });
  });

  test("carries help option types installed by help plugin", () => {
    createCli()
      .use(help())
      .command("inspect")
      .action((ctx) => {
        const typedHelp: boolean | undefined = ctx.options.help;
        return { typedHelp };
      });
  });

  test("carries app option types through explicit routes", () => {
    const registry = createCli().option("--url <url>");
    const ext = createCli().subCommand("registry", registry);

    registry.command("add <name>").action((ctx) => {
      const typedName: string = ctx.params.name;
      const typedUrl: string | undefined = ctx.options.url;
      return { typedName, typedUrl };
    });

    createCli()
      .subCommand("ext", ext)
      .command("inspect")
      .action((ctx) => {
        const typedUrl: string | undefined = ctx.options.url;
        return { typedUrl };
      });
  });

  test("carries child cli option types through route", () => {
    const registry = createCli().option("--url <url>");
    const ext = createCli().subCommand("registry", registry);

    registry.command("add <name>").action((ctx) => {
      const typedName: string = ctx.params.name;
      const typedUrl: string | undefined = ctx.options.url;
      return { typedName, typedUrl };
    });

    createCli()
      .subCommand("ext", ext)
      .command("inspect")
      .action((ctx) => {
        const typedUrl: string | undefined = ctx.options.url;
        return { typedUrl };
      });
  });

  test("rejects implicit child cli routing and removed mount api", () => {
    const child = createCli();

    void (() => {
      // @ts-expect-error subCommand requires an explicit literal path.
      createCli().subCommand(child);
      // @ts-expect-error mount was replaced by subCommand(path, app).
      createCli().mount("child", child);
    });
  });

  test("carries option types through path scoped middleware", () => {
    createCli()
      .option("--json")
      .use("target", (ctx, next) => {
        const typedJson: boolean | undefined = ctx.options.json;
        return next() ?? typedJson;
      });

    createCli()
      .option("--url <url>")
      .use("registry", (ctx, next) => {
        const typedUrl: string | undefined = ctx.options.url;
        return next() ?? typedUrl;
      });
  });

  test("types command error boundaries with route contexts", () => {
    const handler: RouteErrorHandler = (ctx) => ctx.exit(1, { error: ctx.error });

    createCli().command("reusable").catch(handler);
    createCli().catch(handler);

    void (() => {
      // @ts-expect-error root error boundaries use catch(handler).
      createCli().onError(handler);
    });

    createCli()
      .option("--count <count>")
      .command("run <name>")
      .option("--token <token>")
      .catch((ctx) => {
        const typedName: unknown = ctx.params.name;
        const typedCount: unknown = ctx.options.count;
        const typedToken: unknown = ctx.options.token;
        const rawName: string | readonly string[] | undefined = ctx.raw.params.name;
        const rawCount: unknown = ctx.raw.options.count;
        const typedError: unknown = ctx.error;
        return ctx.exit(1, { typedName, typedCount, typedToken, rawName, rawCount, typedError });
      });

    createCli()
      .option("--url <url>")
      .command("sync")
      .catch((ctx) => {
        const typedUrl: unknown = ctx.options.url;
        const typedError: unknown = ctx.error;
        return ctx.exit(1, { typedUrl, typedError });
      });
  });

  test("keeps default middleware params and options source-compatible", () => {
    const middleware: Middleware = (ctx, next) => {
      const typedParam: string | string[] | undefined = ctx.params.anything;
      const typedOption: boolean | string | string[] | undefined = ctx.options.anything;
      return next() ?? { typedParam, typedOption };
    };

    createCli().use(middleware);
  });

  test("infers action params and options from command input features", () => {
    const callInput = input({
      params: [{ name: "operation", required: true }],
      options: [parseOptionSpec("--timeout-ms <ms>")],
      parse(raw) {
        // @ts-expect-error raw command params are immutable parser input
        raw.params.operation = "mutated";
        // @ts-expect-error raw command options are immutable parser input
        raw.options.timeoutMs = "9999";
        return {
          params: { operation: String(raw.params.operation) },
          options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) },
        };
      },
    });
    const callConfig: CommandConfig<{ operation: string }, { timeoutMs: number }> = {
      input: callInput,
      description: "Call operation",
      aliases: ["invoke"],
    };
    const runConfig: CommandConfig = {
      description: "Run command",
      aliases: ["execute"],
    };

    createCli()
      .command("run", runConfig)
      .action((ctx) => {
        const typedParams: Record<never, never> = ctx.params;
        return { typedParams };
      });

    createCli()
      .command(
        "publish <name>",
        meta({
          description: "Publish item",
          aliases: ["pub"],
          examples: ["cli publish notes"],
          usage: "publish <name> [--dry-run]",
          group: "Examples",
        }),
      )
      .action((ctx) => {
        const typedName: string = ctx.params.name;
        return { typedName };
      });

    createCli()
      .command("call", callInput)
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        const rawOperation: string | readonly string[] | undefined = ctx.raw.params.operation;
        return { typedOperation, typedTimeout, rawOperation };
      });

    createCli()
      .command(
        "call",
        callInput,
        meta({
          description: "Call operation",
          aliases: ["invoke"],
          examples: ["cli call search"],
        }),
      )
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });

    createCli()
      .command("call", callConfig)
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });

    createCli()
      .command("call", {
        input: callInput,
        description: "Call operation",
        aliases: ["invoke"],
        examples: ["cli call search"],
        usage: "call <operation> [--timeout-ms <ms>]",
        group: "Operations",
      })
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });

    createCli()
      .command("call")
      .input(callInput)
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });

    createCli()
      .command("call")
      .input(
        input({
          params: [{ name: "operation", required: true }],
          parse(raw) {
            return { params: { operation: String(raw.params.operation) } };
          },
        }),
      )
      .input(
        input({
          options: [parseOptionSpec("--timeout-ms <ms>")],
          parse(raw) {
            return { options: { timeoutMs: Number(raw.options.timeoutMs ?? 30000) } };
          },
        }),
      )
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });

    createCli()
      .command("call")
      .input(
        input({
          params: [{ name: "operation", required: true }],
          metadata: {
            description: "Call operation",
            aliases: ["invoke"],
          },
          parse(raw) {
            return { params: { operation: String(raw.params.operation) } };
          },
        }),
      )
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        return { typedOperation };
      });
  });

  test("keeps command metadata grouping on group only", () => {
    createCli().command("build").group("Build");

    const config: CommandConfig = {
      // @ts-expect-error Command metadata uses group instead of category.
      category: "Build",
    };

    void config;
  });

  test("allows plugins to extend command meta fields and compose command drafts", () => {
    const metadata: CommandMeta = {
      auth: { scope: "deploy:write" },
      shortcut: "dep",
    };
    const publicMetadata: PublicCommandMeta = {
      publicAuth: { scope: "deploy:write" },
    };

    createPlugin((api) => {
      api.compose((command, next) => {
        const typedScope: string | undefined = command.meta.auth?.scope;
        const typedRouteScope: string | undefined = command.meta.auth?.scope;
        if (command.meta.shortcut) command.alias(command.meta.shortcut);
        command.mergeMeta({ auth: { scope: typedScope ?? "deploy:read" } });
        command.use((ctx, next) => {
          const typedCtxScope: string | undefined = ctx.meta.auth?.scope;
          return next() ?? { typedScope, typedRouteScope, typedCtxScope };
        });
        next();
      });

      // @ts-expect-error commandMeta was replaced by compose.
      api.commandMeta("auth", () => undefined);
    });

    createCli()
      .command("deploy")
      .meta(metadata)
      .action((ctx) => {
        const typedScope: string | undefined = ctx.meta.auth?.scope;
        return { typedScope };
      });

    createPublicPlugin((api) => {
      api.compose((command, next) => {
        const typedScope: string | undefined = command.meta.publicAuth?.scope;
        const typedRouteScope: string | undefined = command.meta.publicAuth?.scope;
        command.use((ctx, next) => next() ?? { typedScope, typedRouteScope });
        next();
      });
    });

    createPublicCli()
      .command("deploy")
      .meta(publicMetadata)
      .action((ctx) => {
        const typedScope: string | undefined = ctx.meta.publicAuth?.scope;
        return { typedScope };
      });
  });

  test("allows plugins to contribute commands and explicit routes", () => {
    const ext = createCli().option("--url <url>");
    ext.command("install <name>").action((ctx) => {
      const typedName: string = ctx.params.name;
      const typedUrl: string | undefined = ctx.options.url;
      return { typedName, typedUrl };
    });

    createPlugin((api) => {
      api.command("inspect <name>").action((ctx) => {
        const typedName: string = ctx.params.name;
        return { typedName };
      });

      api.subCommand("ext", ext);

      void (() => {
        // @ts-expect-error subCommand requires an explicit literal path.
        api.subCommand(ext);
      });
    });
  });

  test("infers action return values in command render handlers", () => {
    createCli()
      .command("build <entry>")
      .action((ctx) => ({ entry: ctx.params.entry, ok: true as const }))
      .render((result, ctx) => {
        const typedEntry: string = result.entry;
        const typedOk: true = result.ok;
        const typedCtxParam: string = ctx.params.entry;
        return { typedEntry, typedOk, typedCtxParam };
      });
  });

  test("infers action return values in text and json presenters", () => {
    createCli()
      .command("hello <name>")
      .action((ctx) => ({ greeting: `hello ${ctx.params.name}`, name: ctx.params.name }))
      .text((result) => {
        const typedGreeting: string = result.greeting;
        return typedGreeting;
      })
      .json((result) => {
        const typedName: string = result.name;
        return { typedName };
      });
  });

  test("allows actions to emit unknown events", () => {
    createCli()
      .command("run")
      .action((ctx) => {
        ctx.emit("custom", { value: 1 });
        const typedEvents = ctx.events();
        return { typedEvents };
      });
  });

  test("carries context value types installed by plugins", () => {
    const auth = context<{ user: { id: string } }>((ctx, next) => {
      ctx.set("user", { id: "test-user" });
      ctx.var.user = { id: "test-user" };
      return next();
    });

    createCli()
      .use(auth)
      .on("custom", (ctx) => {
        const typedId: string | undefined = ctx.get("user")?.id;
        const typedVarId: string | undefined = ctx.var.user?.id;
        return { typedId, typedVarId };
      })
      .command("me")
      .action((ctx) => {
        const typedId: string | undefined = ctx.get("user")?.id;
        const typedVarId: string | undefined = ctx.var.user?.id;
        return { typedId, typedVarId };
      });
  });

  test("allows render handlers to consume custom action result objects", () => {
    class CustomResult {
      constructor(readonly value: string) {}
    }

    createCli()
      .command("stream")
      .action(() => new CustomResult("ok"))
      .render((result) => {
        const typedValue: string = result.value;
        return typedValue;
      });
  });
});

function rendererOptionsPlugin() {
  return createPlugin<{ json?: boolean; events?: boolean }>((api) => {
    api.option(parseOptionSpec("--json"));
    api.option(parseOptionSpec("--events"));
  });
}
