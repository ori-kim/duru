import { describe, expect, test } from "bun:test";
import { createCli, createRouter, renderer } from "./index.ts";
import type { Renderer } from "./index.ts";

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
    router.command("inspect", "Inspect app").action((ctx) => ({ json: ctx.options.json }));
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(router);

    const result = await cli.run(["inspect", "--json"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ json: true });
  });

  test("mounts named routers as command namespaces", async () => {
    const ext = createRouter({ name: "ext", description: "Manage extensions" });
    ext.command("add <name>", "Add extension").action((ctx) => ({ added: ctx.params.name }));
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer())).use(ext);

    const result = await cli.run(["ext", "add", "example"]);

    expect(result.ok).toBe(true);
    expect(result.value).toEqual({ added: "example" });
  });

  test("mounts routers inside routers", async () => {
    const registry = createRouter({ name: "registry" }).option("--url <url>");
    registry.command("add <name>", "Add registry").action((ctx) => {
      return { name: ctx.params.name, pattern: ctx.request.pattern, url: ctx.options.url };
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

  test("allows notFound handlers to override exit results", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.notFound((ctx) => ctx.exit(2, { missing: ctx.argv.join(" ") }));

    const result = await cli.run(["missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ missing: "missing" });
  });

  test("allows error handlers to override thrown action errors", async () => {
    const cli = createCli().use(renderer(testRenderer()));
    cli.onError((ctx) => ctx.exit(7, { message: (ctx.error as Error).message }));
    cli.command("boom").action(() => {
      throw new Error("failed");
    });

    const result = await cli.run(["boom"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.result).toEqual({ message: "failed" });
  });

  test("returns command-level help with route options", async () => {
    const cli = createCli({ name: "clip" }).use(renderer(testRenderer()));
    cli
      .command("hello <name>", "Say hello")
      .option("-u, --uppercase", "Uppercase output")
      .action(() => undefined);

    const result = await cli.run(["hello", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: clip hello <name>");
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
    const cli = createCli().use(renderer(testRenderer("json"), testRenderer("text")));
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
    const cli = createCli().use(renderer(testRenderer("json")));
    cli.command("run").action((ctx) => {
      ctx.emit("log", { message: "started" });
      return { ok: true };
    });

    const result = await cli.run(["run", "--json", "--events"]);

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
