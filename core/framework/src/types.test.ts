import { describe, test } from "bun:test";
import { createCli, createRouter, renderer } from "./index.ts";
import type { OptionSpecOptions, PatternParams, Renderer } from "./index.ts";

type Equal<TLeft, TRight> = (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type _PatternParams = Expect<
  Equal<PatternParams<"build <entry> [mode] [...args]">, { entry: string; mode?: string; args: string[] }>
>;
type _BooleanOption = Expect<Equal<OptionSpecOptions<"-w, --watch">, { watch?: boolean }>>;
type _ValueOption = Expect<Equal<OptionSpecOptions<"--timeout-ms <ms>">, { timeoutMs?: string }>>;
type _NegatedOption = Expect<Equal<OptionSpecOptions<"--no-color">, { color?: boolean }>>;

describe("public type inference", () => {
  test("infers action params, options, and context from fluent declarations", () => {
    createCli()
      .option("--json")
      .command("build <entry> [...args]")
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
      .use(renderer(typeRenderer()))
      .command("inspect")
      .action((ctx) => {
        const typedJson: boolean | undefined = ctx.options.json;
        const typedEvents: boolean | undefined = ctx.options.events;
        const typedCtxJson: boolean | undefined = ctx.options.json;
        const typedCtxEvents: boolean | undefined = ctx.options.events;
        return { typedJson, typedEvents, typedCtxJson, typedCtxEvents };
      });
  });

  test("carries router option types through cli.use(router)", () => {
    const router = createRouter().option("--json");

    router.command("inspect").action((ctx) => {
      const typedJson: boolean | undefined = ctx.options.json;
      const typedCtxJson: boolean | undefined = ctx.options.json;
      return { typedJson, typedCtxJson };
    });

    createCli().use(router);
  });

  test("carries child router option types through router.use(router)", () => {
    const registry = createRouter({ name: "registry" }).option("--url <url>");
    const ext = createRouter({ name: "ext" }).use(registry);

    registry.command("add <name>").action((ctx) => {
      const typedName: string = ctx.params.name;
      const typedUrl: string | undefined = ctx.options.url;
      const typedCtxUrl: string | undefined = ctx.options.url;
      return { typedName, typedUrl, typedCtxUrl };
    });

    createCli()
      .use(ext)
      .command("inspect")
      .action((ctx) => {
        const typedUrl: string | undefined = ctx.options.url;
        return { typedUrl };
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
        ctx.emit({ type: "custom", value: 1 });
        const typedEvents: readonly unknown[] = ctx.events();
        return { typedEvents };
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

function typeRenderer(): Renderer {
  return {
    id: "json",
    render() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}
