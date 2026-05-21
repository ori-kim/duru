import { describe, expect, test } from "bun:test";
import { createCli, createRouter, renderer } from "./index.ts";
import type { Renderer } from "./index.ts";

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

  test("combines usage output from mounted routers", async () => {
    const registry = createRouter({ name: "registry" });
    registry.command("add <name>", "Add registry").action(() => undefined);
    const ext = createRouter({ name: "ext" }).use(registry);
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(ext);

    const result = await cli.run(["--help"]);

    expect(result.rendered?.stdout.match(/Usage: clip <command>/g)).toHaveLength(1);
    expect(result.rendered?.stdout).toContain("ext registry add <name>");
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

  test("mounts named routers as command namespaces", async () => {
    const ext = createRouter({ name: "ext", description: "Manage extensions" });
    ext.command("add <name>", "Add extension").action((name) => ({ added: name }));
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(ext);

    const result = await cli.run(["ext", "add", "example"]);

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([{ kind: "data", value: { added: "example" } }]);
  });

  test("mounts routers inside routers", async () => {
    const registry = createRouter({ name: "registry" }).option("--url <url>");
    registry.command("add <name>", "Add registry").action((name, options, ctx) => {
      return { name, pattern: ctx.request.pattern, url: options.url };
    });
    const ext = createRouter({ name: "ext" }).use(registry);
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(ext);

    const result = await cli.run(["ext", "registry", "add", "example", "--url", "https://api.example.com"]);

    expect(result.ok).toBe(true);
    expect(result.outputs).toEqual([
      {
        kind: "data",
        value: {
          name: "example",
          pattern: "ext registry add <name>",
          url: "https://api.example.com",
        },
      },
    ]);
  });

  test("runs parent and child router middleware for nested routes", async () => {
    const calls: string[] = [];
    const child = createRouter({ name: "child" });
    child.use(async (_ctx, next) => {
      calls.push("child:before");
      await next();
      calls.push("child:after");
    });
    child.command("run").action(() => {
      calls.push("action");
      return undefined;
    });
    const parent = createRouter({ name: "parent" });
    parent.use(async (_ctx, next) => {
      calls.push("parent:before");
      await next();
      calls.push("parent:after");
    });
    parent.use(child);
    const cli = createCli({ name: "clip" }).use(parent);

    await cli.run(["parent", "child", "run"], { render: false });

    expect(calls).toEqual(["parent:before", "child:before", "action", "child:after", "parent:after"]);
  });

  test("renders action return values through command render handlers", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("build <entry>")
      .action((entry) => ({ entry, status: "ok" }))
      .render((result) => ({ kind: "text", text: `${result.status}: ${result.entry}` }));

    const result = await cli.run(["build", "src/index.ts"]);

    expect(result.outputs).toEqual([{ kind: "text", text: "ok: src/index.ts" }]);
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
