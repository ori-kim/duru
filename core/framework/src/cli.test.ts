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
    expect(result.result).toEqual({ entry: "src/index.ts", watch: true });
    expect(result.value).toEqual({ entry: "src/index.ts", watch: true });
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
      return "done";
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
    router.command("inspect", "Inspect app").action((options) => ({ json: options.json }));
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(router);

    const result = await cli.run(["inspect", "--json"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ json: true });
  });

  test("mounts named routers as command namespaces", async () => {
    const ext = createRouter({ name: "ext", description: "Manage extensions" });
    ext.command("add <name>", "Add extension").action((name) => ({ added: name }));
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(ext);

    const result = await cli.run(["ext", "add", "example"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ added: "example" });
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
    expect(result.value).toEqual({
      name: "example",
      pattern: "ext registry add <name>",
      url: "https://api.example.com",
    });
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

  test("collects unknown events emitted by actions", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.command("run").action((_options, ctx) => {
      ctx.emit({ type: "log", message: "started" });
      return { ok: true };
    });

    const result = await cli.run(["run"]);

    expect(result.events).toEqual([{ type: "log", message: "started" }]);
    expect(result.value).toEqual({ ok: true });
  });

  test("uses format presenters for action return values", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("build <entry>")
      .action((entry) => ({ entry, status: "ok" }))
      .render("test", (result) => `${result.status}: ${result.entry}`);

    const result = await cli.run(["build", "src/index.ts"]);

    expect(result.value).toBe("ok: src/index.ts");
    expect(result.rendered?.stdout).toBe('"ok: src/index.ts"\n');
  });

  test("supports text and json presenter shortcuts", async () => {
    const cli = createCli().use(renderer(testRenderer("json"), testRenderer("text")));
    cli
      .command("hello <name>")
      .action((name) => ({ greeting: `hello ${name}` }))
      .text((result) => result.greeting)
      .json((result) => result);

    const text = await cli.run(["hello", "example"]);
    const json = await cli.run(["hello", "example", "--json"]);

    expect(text.value).toBe("hello example");
    expect(json.value).toEqual({ greeting: "hello example" });
  });

  test("includes emitted events in json rendering when requested", async () => {
    const cli = createCli().use(renderer(testRenderer("json")));
    cli.command("run").action((_options, ctx) => {
      ctx.emit({ type: "log", message: "started" });
      return { ok: true };
    });

    const result = await cli.run(["run", "--json", "--events"]);

    expect(result.value).toEqual({ ok: true });
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({
      result: { ok: true },
      events: [{ type: "log", message: "started" }],
    });
  });

  test("renders action return values through command render handlers", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli
      .command("build <entry>")
      .action((entry) => ({ entry, status: "ok" }))
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
