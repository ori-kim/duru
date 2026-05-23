import { describe, expect, test } from "bun:test";
import { createCli, createPlugin } from "../index.ts";
import type { CliPluginApi, CompletionContext } from "../index.ts";

describe("@duru/cli-kit completion", () => {
  test("completes commands, aliases, and options from the current command graph", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    const capture = createPlugin((api) => {
      complete = api.complete;
    });

    const cli = createCli({ name: "duru" }).use(capture);
    cli
      .command("hello <name>", "Say hello")
      .alias("hi <name>")
      .option("--uppercase", "Uppercase the greeting")
      .group("Examples")
      .action(() => undefined);
    cli
      .command("internal", "Internal")
      .hidden()
      .action(() => undefined);

    const root = await complete?.(completionContext(["he"]));
    const alias = await complete?.(completionContext(["hi"]));
    const options = await complete?.(completionContext(["hello", "--"]));

    expect(root?.items).toContainEqual({
      value: "hello",
      description: "Say hello",
      kind: "command",
      group: "Examples",
    });
    expect(alias?.items).toContainEqual({
      value: "hi",
      description: "Say hello",
      kind: "command",
      group: "Examples",
    });
    expect(root?.items.some((item) => item.value === "internal")).toBe(false);
    expect(options?.items).toContainEqual({
      value: "--uppercase",
      description: "Uppercase the greeting",
      kind: "option",
      group: "options",
    });
  });

  test("keeps contributor results when another contributor fails", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    const capture = createPlugin((api) => {
      api.completion({
        id: "broken",
        async complete() {
          throw new Error("boom");
        },
      });
      api.completion({
        id: "targets",
        async complete() {
          return [{ value: "test-service", description: "cli target", kind: "target", group: "targets" }];
        },
      });
      complete = api.complete;
    });

    const cli = createCli({ name: "duru" }).use(capture);
    cli.command("hello", "Say hello").action(() => undefined);

    const result = await complete?.(completionContext([""]));

    expect(result?.items).toContainEqual({
      value: "test-service",
      description: "cli target",
      kind: "target",
      group: "targets",
    });
    expect(result?.errors).toEqual([{ contributor: "broken", message: "boom" }]);
  });
});

function completionContext(argv: readonly string[]): CompletionContext {
  const position = Math.max(0, argv.length - 1);
  return {
    argv,
    cursor: argv.length,
    current: argv[position] ?? "",
    previous: position > 0 ? argv[position - 1] : undefined,
    position,
  };
}
