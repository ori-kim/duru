import { describe, test } from "bun:test";
import { createCli, createRouter, renderer } from "./index.ts";
import type { OptionSpecOptions, PatternParams, Renderer } from "./types.ts";

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
      .action((entry, args, options, ctx) => {
        const typedEntry: string = entry;
        const typedArgs: string[] = args;
        const typedJson: boolean | undefined = options.json;
        const typedWatch: boolean | undefined = options.watch;
        const typedTimeout: string | undefined = options.timeoutMs;
        const typedParam: string = ctx.params.entry;

        return { typedEntry, typedArgs, typedJson, typedWatch, typedTimeout, typedParam };
      });
  });

  test("carries option types installed by use plugins into commands", () => {
    createCli()
      .use(renderer(typeRenderer()))
      .command("inspect")
      .action((options, ctx) => {
        const typedJson: boolean | undefined = options.json;
        const typedCtxJson: boolean | undefined = ctx.options.json;
        return { typedJson, typedCtxJson };
      });
  });

  test("carries router option types through cli.use(router)", () => {
    const router = createRouter().option("--json");

    router.command("inspect").action((options, ctx) => {
      const typedJson: boolean | undefined = options.json;
      const typedCtxJson: boolean | undefined = ctx.options.json;
      return { typedJson, typedCtxJson };
    });

    createCli().use(router);
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
