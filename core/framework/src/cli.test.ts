import { describe, expect, test } from "bun:test";
import { createCli, createRouter, renderer } from "./index.ts";
import type { Renderer } from "./types.ts";

describe("createCli", () => {
  test("routes commands with params and options into actions", async () => {
    const cli = createCli().use(renderer(testRenderer()));

    cli
      .command("build <entry>", "Build project")
      .option("-w, --watch", "watch files")
      .action((entry, options) => ({ entry, watch: options.watch }));

    const result = await cli.run(["build", "src/index.ts", "--watch"]);

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([{ kind: "data", value: { entry: "src/index.ts", watch: true } }]);
    expect(result.rendered?.stdout).toContain("src/index.ts");
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
    cli.command("hello").action((_options, ctx) => {
      calls.push(ctx.service<string>("message") ?? "missing");
      ctx.output.text("done");
      return undefined;
    });

    await cli.run(["hello"]);

    expect(calls).toEqual(["before", "hello", "after"]);
  });

  test("returns usage output for help", async () => {
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer()));
    cli.command("hello <name>", "Say hello").action(() => undefined);

    const result = await cli.run(["--help"]);

    expect(result.rendered?.stdout).toContain("Usage: clip <command>");
    expect(result.rendered?.stdout).toContain("hello <name>");
  });

  test("installs standalone routers through use", async () => {
    const router = createRouter().option("--json");
    router.command("inspect", "Inspect app").action((options, ctx) => {
      ctx.output.data({ json: options.json });
      return undefined;
    });
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(router);

    const result = await cli.run(["inspect", "--json"]);

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([{ kind: "data", value: { json: true } }]);
  });
});

function testRenderer(): Renderer {
  return {
    id: "test",
    render(outputs) {
      return {
        stdout: `${JSON.stringify(outputs)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}
