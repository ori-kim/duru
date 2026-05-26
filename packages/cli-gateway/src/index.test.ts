import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type GatewayAdapter,
  type GatewayContext,
  type GatewayResult,
  cliGateway,
  createGatewayCli,
  createMemoryGatewayStore,
  defaultGatewayAdapters,
} from "@duru/cli-gateway";
import { createCli, help } from "@duru/cli-kit";
import { type SecretProvider, createResolver } from "@duru/secrets";
import type { CliGatewayOptions } from "./types";

describe("@duru/cli-gateway contract", () => {
  test("creates an installable plugin without owning persistence", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store });

    const result = await cli.run(["missing"], { render: false });

    expect(defaultGatewayAdapters().map((adapter) => adapter.type)).toEqual([
      "cli",
      "script",
      "api",
      "graphql",
      "mcp",
      "grpc",
    ]);
    expect(result.ok).toBe(false);
  });

  test("provides a default cli adapter that executes local commands", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "cli");
    const config = adapter?.schema.parse({ command: "echo" });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "say", type: "cli", config },
            config,
            context: { store },
          })
        : undefined;

    const result = await target?.invoke({ argv: ["hello", "example"] });

    expect(result).toEqual({ ok: true, value: "hello example", exitCode: 0 });
  });

  test("provides default cli adapter completion from command help output", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "cli");
    const helpText = [
      "TERMS",
      "  stack: A sequence of pull requests",
      "",
      "CORE COMMANDS",
      "  gt init: Initializes a repository",
      "  gt log: Shows the current stack",
    ].join("\n");
    const config = adapter?.schema.parse({ command: "sh", args: ["-c", `printf '%s\\n' ${shellQuote(helpText)}`] });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "gt", type: "cli", config },
            config,
            context: { store },
          })
        : undefined;

    const result = await target?.complete?.({ target: "gt", argv: [""] });

    expect(result).toContainEqual({
      value: "init",
      description: "Initializes a repository",
      kind: "operation",
      group: "gateway operations",
    });
    expect(result).toContainEqual({
      value: "log",
      description: "Shows the current stack",
      kind: "operation",
      group: "gateway operations",
    });
    expect(result?.some((item) => item.value === "stack")).toBe(false);
  });

  test("provides a default script adapter with cwd and env aware config", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "script");
    const config = adapter?.schema.parse({ command: "echo", args: ["hello"] });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "say", type: "script", config },
            config,
            context: { store },
          })
        : undefined;

    const result = await target?.invoke({ argv: ["example"] });

    expect(result).toEqual({ ok: true, value: "hello example", exitCode: 0 });
  });

  test("provides a script target with configured commands", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "script");
    const config = adapter?.schema.parse({
      description: "Local scripts",
      commands: {
        greet: {
          description: "Greet someone",
          script: "printf 'hello %s\\n' \"$1\"",
          args: ["name"],
        },
      },
    });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "local-scripts", type: "script", config },
            config,
            context: { store },
          })
        : undefined;

    const catalog = await target?.catalog?.({ target: "local-scripts" });
    const help = await target?.invoke({ argv: ["--help"] });
    const describe = await target?.invoke({ argv: ["describe", "greet"] });
    const run = await target?.invoke({ argv: ["greet", "example"] });

    expect(catalog).toEqual([{ name: "greet", description: "Greet someone" }]);
    expect(help).toMatchObject({
      ok: true,
      value: {
        target: "local-scripts",
        type: "script",
        usage: "local-scripts <command>",
      },
    });
    expect(describe).toEqual({ ok: true, value: { name: "greet", description: "Greet someone" }, exitCode: 0 });
    expect(run).toEqual({ ok: true, value: "hello example", exitCode: 0 });
  });

  test("provides a default api adapter that executes HTTP requests", async () => {
    const store = createMemoryGatewayStore();
    const calls: unknown[] = [];
    const adapter = defaultGatewayAdapters().find((item) => item.type === "api");
    const config = adapter?.schema.parse({
      baseUrl: "https://api.example.com",
      headers: { "X-Custom-Header": "custom-from-config" },
    });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "notes-api", type: "api", config },
            config,
            context: {
              store,
              services: {
                async fetch(input: string | URL | Request, init?: RequestInit) {
                  calls.push({ input: String(input), init });
                  return new Response(JSON.stringify({ ok: true }), {
                    status: 200,
                    statusText: "OK",
                    headers: { "content-type": "application/json" },
                  });
                },
              },
            },
          })
        : undefined;

    const result = await target?.invoke({
      argv: [
        "POST",
        "/v1/items",
        "--tag",
        "test-service",
        "--header",
        "X-Request-Id: example",
        "--body",
        '{"name":"example"}',
      ],
    });

    expect(calls).toEqual([
      {
        input: "https://api.example.com/v1/items?tag=test-service",
        init: {
          method: "POST",
          signal: undefined,
          headers: {
            "X-Custom-Header": "custom-from-config",
            "X-Request-Id": "example",
            "content-type": "application/json",
          },
          body: '{"name":"example"}',
        },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { status: 200, statusText: "OK", body: { ok: true } },
      exitCode: 0,
    });
  });

  test("provides a default graphql adapter that executes GraphQL requests", async () => {
    const store = createMemoryGatewayStore();
    const calls: unknown[] = [];
    const adapter = defaultGatewayAdapters().find((item) => item.type === "graphql");
    const config = adapter?.schema.parse({
      endpoint: "https://api.example.com/graphql",
      headers: { "X-Custom-Header": "custom-from-config" },
    });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "search-api", type: "graphql", config },
            config,
            context: {
              store,
              services: {
                async fetch(input: string | URL | Request, init?: RequestInit) {
                  calls.push({ input: String(input), init });
                  return new Response(JSON.stringify({ data: { search: [] } }), {
                    status: 200,
                    statusText: "OK",
                    headers: { "content-type": "application/json" },
                  });
                },
              },
            },
          })
        : undefined;

    const result = await target?.invoke({
      argv: [
        "--query",
        "query Search($tag: String!) { search(tag: $tag) { id } }",
        "--variables",
        '{"tag":"test-service"}',
      ],
    });

    expect(calls).toEqual([
      {
        input: "https://api.example.com/graphql",
        init: {
          method: "POST",
          signal: undefined,
          headers: {
            "X-Custom-Header": "custom-from-config",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: "query Search($tag: String!) { search(tag: $tag) { id } }",
            variables: { tag: "test-service" },
          }),
        },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { status: 200, statusText: "OK", body: { data: { search: [] } } },
      exitCode: 0,
    });
  });

  test("provides a default mcp adapter that executes JSON-RPC requests", async () => {
    const store = createMemoryGatewayStore();
    const calls: unknown[] = [];
    const adapter = defaultGatewayAdapters().find((item) => item.type === "mcp");
    const config = adapter?.schema.parse({
      url: "https://catservice.example.com/mcp",
      protocolVersion: "2025-06-18",
      auth: "oauth",
    });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "mcp", config },
            config,
            context: {
              store,
              services: {
                async fetch(input: string | URL | Request, init?: RequestInit) {
                  calls.push({ input: String(input), init });
                  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
                    status: 200,
                    statusText: "OK",
                    headers: { "content-type": "application/json" },
                  });
                },
              },
            },
          })
        : undefined;

    const result = await target?.invoke({ argv: ["tools/list", "--params", '{"cursor":"first"}'] });

    expect(config).toMatchObject({ url: "https://catservice.example.com/mcp" });
    expect(config).not.toHaveProperty("auth");
    expect(calls).toEqual([
      {
        input: "https://catservice.example.com/mcp",
        init: {
          method: "POST",
          signal: undefined,
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: { cursor: "first" },
          }),
        },
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: { status: 200, statusText: "OK", body: { jsonrpc: "2.0", id: 1, result: { tools: [] } } },
      exitCode: 0,
    });
  });

  test("provides mcp catalog and default invocation through tools/list", async () => {
    const store = createMemoryGatewayStore();
    const calls: unknown[] = [];
    const adapter = defaultGatewayAdapters().find((item) => item.type === "mcp");
    const config = adapter?.schema.parse({ url: "https://catservice.example.com/mcp" });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "mcp", config },
            config,
            context: {
              store,
              services: {
                async fetch(input: string | URL | Request, init?: RequestInit) {
                  calls.push({ input: String(input), body: init?.body });
                  return new Response(
                    JSON.stringify({
                      jsonrpc: "2.0",
                      id: 1,
                      result: {
                        tools: [
                          {
                            name: "listCats",
                            description: "List cats",
                            inputSchema: { type: "object", properties: {} },
                          },
                        ],
                      },
                    }),
                    {
                      status: 200,
                      statusText: "OK",
                      headers: { "content-type": "application/json" },
                    },
                  );
                },
              },
            },
          })
        : undefined;

    const catalog = await target?.catalog?.({ target: "catservice" });
    const noArgs = await target?.invoke({ argv: [] });
    const tools = await target?.invoke({ argv: ["tools"] });
    const dryRun = await target?.invoke({ argv: [], dryRun: true });

    expect(catalog).toEqual([
      {
        name: "listCats",
        description: "List cats",
        inputSchema: { type: "object", properties: {} },
      },
    ]);
    expect(noArgs).toEqual({ ok: true, value: catalog, exitCode: 0 });
    expect(tools).toEqual({ ok: true, value: catalog, exitCode: 0 });
    expect(dryRun).toMatchObject({
      ok: true,
      value: { request: { url: "https://catservice.example.com/mcp", rpcMethod: "tools/list" } },
      exitCode: 0,
    });
    expect(calls.map((call) => JSON.parse(String((call as { body: unknown }).body)).method)).toEqual([
      "tools/list",
      "tools/list",
      "tools/list",
    ]);
  });

  test("parses MCP SSE tools/list responses for tools, catalog, and help", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "mcp");
    const config = adapter?.schema.parse({ url: "https://catservice.example.com/mcp" });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "mcp", config },
            config,
            context: {
              store,
              services: {
                async fetch() {
                  return new Response(
                    [
                      "event: message",
                      'data: {"result":{"tools":[{"name":"listCats","description":"List cats","inputSchema":{"type":"object","properties":{}}}]}}',
                      "",
                    ].join("\n"),
                    {
                      status: 200,
                      statusText: "OK",
                      headers: { "content-type": "text/event-stream" },
                    },
                  );
                },
              },
            },
          })
        : undefined;

    const catalog = await target?.catalog?.({ target: "catservice" });
    const tools = await target?.invoke({ argv: ["tools"] });
    const help = await target?.invoke({ argv: ["--help"] });

    expect(catalog).toEqual([
      { name: "listCats", description: "List cats", inputSchema: { type: "object", properties: {} } },
    ]);
    expect(tools).toEqual({ ok: true, value: catalog, exitCode: 0 });
    expect(help).toEqual({
      ok: true,
      value: {
        target: "catservice",
        type: "mcp",
        usage: "catservice <tool|method>",
        operations: [
          { name: "tools", description: "List available MCP tools" },
          { name: "describe <tool>", description: "Describe an MCP tool" },
          { name: "types", description: "List available MCP types" },
          { name: "raw <method>", description: "Call a raw MCP JSON-RPC method" },
          { name: "listCats", description: "List cats", inputSchema: { type: "object", properties: {} } },
        ],
      },
      exitCode: 0,
    });
  });

  test("provides MCP stdio transport catalog discovery", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-mcp-stdio-"));
    const server = join(home, "mcp-server.js");
    await writeFile(
      server,
      [
        "process.stdin.setEncoding('utf8');",
        "let buffer = '';",
        "process.stdin.on('data', (chunk) => {",
        "  buffer += chunk;",
        "  const lines = buffer.split('\\n');",
        "  buffer = lines.pop() ?? '';",
        "  for (const line of lines) {",
        "    if (!line.trim()) continue;",
        "    const req = JSON.parse(line);",
        "    if (req.method === 'initialize') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: {} }) + '\\n');",
        "    } else if (req.method === 'tools/list') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { tools: [{ name: 'listCats', description: 'List cats' }] } }) + '\\n');",
        "    }",
        "  }",
        "});",
      ].join("\n"),
    );
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "mcp");
    const config = adapter?.schema.parse({ transport: "stdio", command: "bun", args: [server] });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "mcp", config },
            config,
            context: { store },
          })
        : undefined;

    const catalog = await target?.catalog?.({ target: "catservice" });

    expect(catalog).toEqual([{ name: "listCats", description: "List cats" }]);
  });

  test("provides MCP SSE transport catalog discovery", async () => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const calls: string[] = [];
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "mcp");
    const config = adapter?.schema.parse({ transport: "sse", url: "https://catservice.example.com/sse" });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "mcp", config },
            config,
            context: {
              store,
              services: {
                async fetch(input: string | URL | Request) {
                  calls.push(String(input));
                  if (String(input).endsWith("/sse")) {
                    return new Response(
                      new ReadableStream<Uint8Array>({
                        start(streamController) {
                          controller = streamController;
                          streamController.enqueue(encoder.encode("event: endpoint\ndata: /messages\n\n"));
                        },
                      }),
                      { headers: { "content-type": "text/event-stream" } },
                    );
                  }
                  controller?.enqueue(
                    encoder.encode(
                      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"listCats","description":"List cats"}]}}\n\n',
                    ),
                  );
                  return new Response("", { status: 202, statusText: "Accepted" });
                },
              },
            },
          })
        : undefined;

    const catalog = await target?.catalog?.({ target: "catservice" });

    expect(catalog).toEqual([{ name: "listCats", description: "List cats" }]);
    expect(calls).toEqual(["https://catservice.example.com/sse", "https://catservice.example.com/messages"]);
  });

  test("provides a default grpc adapter that executes grpcurl-compatible commands", async () => {
    const store = createMemoryGatewayStore();
    const adapter = defaultGatewayAdapters().find((item) => item.type === "grpc");
    const config = adapter?.schema.parse({
      address: "localhost:50051",
      command: "echo",
      headers: { "X-Custom-Header": "custom-from-config" },
      plaintext: true,
    });
    const target =
      adapter && config
        ? adapter.createTarget({
            manifest: { name: "catservice", type: "grpc", config },
            config,
            context: { store },
          })
        : undefined;

    const result = await target?.invoke({ argv: ["CatService.ListCats"] });

    expect(result).toEqual({
      ok: true,
      value: "-plaintext -H X-Custom-Header: custom-from-config localhost:50051 CatService.ListCats",
      exitCode: 0,
    });
  });

  test("stores target records in memory without exposing mutable references", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "test-service",
          type: "cli",
          config: { command: "test-service" },
          timeoutMs: 30000,
        },
      ],
    });

    const target = await store.getTarget("test-service");
    expect(target).toEqual({
      name: "test-service",
      type: "cli",
      config: { command: "test-service" },
      timeoutMs: 30000,
    });

    if (target) target.config = { command: "mutated" };

    expect(await store.getTarget("test-service")).toEqual({
      name: "test-service",
      type: "cli",
      config: { command: "test-service" },
      timeoutMs: 30000,
    });

    await store.saveTarget({ name: "notes-api", type: "openapi", config: { url: "https://api.example.com" } });

    expect((await store.listTargets()).map((item) => item.name)).toEqual(["notes-api", "test-service"]);
  });

  test("stores profiles and aliases scoped by target", async () => {
    const store = createMemoryGatewayStore();
    await store.saveTarget({ name: "test-service", type: "cli", config: { command: "test-service" } });
    await store.saveProfile("test-service", {
      target: "test-service",
      name: "dev",
      config: { env: { SERVICE_MODE: "example" } },
    });
    await store.saveAlias("test-service", {
      target: "test-service",
      name: "cats",
      operation: "listCats",
      args: ["--limit", "10"],
    });

    expect(await store.getProfile("test-service", "dev")).toEqual({
      target: "test-service",
      name: "dev",
      config: { env: { SERVICE_MODE: "example" } },
    });
    expect(await store.listAliases("test-service")).toEqual([
      { target: "test-service", name: "cats", operation: "listCats", args: ["--limit", "10"] },
    ]);

    await store.removeTarget("test-service");

    expect(await store.getTarget("test-service")).toBeUndefined();
    expect(await store.listProfiles("test-service")).toEqual([]);
    expect(await store.listAliases("test-service")).toEqual([]);
  });

  test("exposes adapter authoring types for gateway targets", async () => {
    const store = createMemoryGatewayStore();
    const context: GatewayContext = { store, env: { DURU_HOME: "test-home" } };
    const manifest = { name: "test-service", type: "cli", config: { command: "test-service" } };
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config, context }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return {
              ok: true,
              value: { command: config.command, argv: ctx.argv, home: context.env?.DURU_HOME },
            };
          },
          listRow() {
            return { name: manifest.name, type: manifest.type, summary: config.command };
          },
          async complete(_ctx) {
            return [{ value: "tools", description: "List available tools" }];
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;

    const target = adapter.createTarget({
      manifest,
      config: adapter.schema.parse(manifest.config),
      context,
    });
    const result: GatewayResult = await target.invoke({ argv: ["tools"] });

    expect(target.listRow?.()).toEqual({ name: "test-service", type: "cli", summary: "test-service" });
    expect(await target.complete?.({ argv: [""] })).toEqual([{ value: "tools", description: "List available tools" }]);
    expect(result).toEqual({
      ok: true,
      value: { command: "test-service", argv: ["tools"], home: "test-home" },
    });
  });

  test("supports gateway target auth and refresh capabilities", async () => {
    const store = createMemoryGatewayStore();
    const context: GatewayContext = { store };
    const manifest = { name: "notes-api", type: "api", config: { url: "https://api.example.com", version: 1 } };
    const calls: string[] = [];
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          return value as { url: string; version: number };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: true };
          },
          async refresh(ctx) {
            return { config: { ...config, refreshedTarget: ctx.target, version: config.version + 1 } };
          },
          auth: {
            async login(ctx) {
              calls.push(`login:${ctx.target}:${ctx.profile ?? "default"}`);
            },
            async logout(ctx) {
              calls.push(`logout:${ctx.target}:${ctx.profile ?? "default"}`);
            },
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string; version: number }>;

    const target = adapter.createTarget({
      manifest,
      config: adapter.schema.parse(manifest.config),
      context,
    });
    const refreshed = await target.refresh?.({ target: "notes-api" });
    await target.auth?.login?.({ target: "notes-api", profile: "dev" });
    await target.auth?.logout?.({ target: "notes-api" });

    expect(refreshed).toEqual({
      config: { url: "https://api.example.com", refreshedTarget: "notes-api", version: 2 },
    });
    expect(calls).toEqual(["login:notes-api:dev", "logout:notes-api:default"]);
  });
});

describe("@duru/cli-gateway commands", () => {
  test("registers add command that saves adapter-created target records", async () => {
    const store = createMemoryGatewayStore();
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string; args: readonly string[] };
        },
      },
      async add(input) {
        return { command: input.argv[0] ?? input.name, args: input.argv.slice(1) };
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string; args: readonly string[] }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "add", "test-service", "run", "cats", "--type", "cli"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "test-service", type: "cli" });
    expect(await store.getTarget("test-service")).toEqual({
      name: "test-service",
      type: "cli",
      config: { command: "run", args: ["cats"] },
    });
  });

  test("passes add options into default gateway adapters", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    await cli.run(["gateway", "add", "catservice", "bun", "server.ts", "--type", "mcp", "--transport", "stdio"], {
      render: false,
    });
    await cli.run(["gateway", "add", "local-scripts", "--type", "script", "--description", "Local scripts"], {
      render: false,
    });

    expect(await store.getTarget("catservice")).toEqual({
      name: "catservice",
      type: "mcp",
      config: { transport: "stdio", command: "bun", args: ["server.ts"] },
    });
    expect(await store.getTarget("local-scripts")).toEqual({
      name: "local-scripts",
      type: "script",
      config: { description: "Local scripts", commands: {} },
    });
  });

  test("registers add command with target ACL options", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    const result = await cli.run(
      [
        "gateway",
        "add",
        "catservice",
        "https://catservice.example.com/mcp",
        "--type",
        "mcp",
        "--allow",
        "list*",
        "--allow",
        "search",
        "--deny",
        "delete*",
      ],
      { render: false },
    );

    expect(result.result).toEqual({ name: "catservice", type: "mcp" });
    expect(await store.getTarget("catservice")).toEqual({
      name: "catservice",
      type: "mcp",
      config: { url: "https://catservice.example.com/mcp" },
      allow: ["list*", "search"],
      deny: ["delete*"],
    });
  });

  test("registers gateway-prefixed management commands", async () => {
    const store = createMemoryGatewayStore();
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string; args: readonly string[] };
        },
      },
      async add(input) {
        return { command: input.argv[0] ?? input.name, args: input.argv.slice(1) };
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string; args: readonly string[] }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const add = await cli.run(["gateway", "add", "test-service", "run", "cats", "--type", "cli"], {
      render: false,
    });
    const list = await cli.run(["gateway", "list"], { render: false });

    expect(add.result).toEqual({ name: "test-service", type: "cli" });
    expect(list.result).toEqual([{ name: "test-service", type: "cli" }]);
  });

  test("lets hosts choose the gateway command namespace explicitly", async () => {
    const store = createMemoryGatewayStore();
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string; args: readonly string[] };
        },
      },
      async add(input) {
        return { command: input.argv[0] ?? input.name, args: input.argv.slice(1) };
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string; args: readonly string[] }>;
    const gatewayOptions = { store, adapters: [adapter] };
    const cli = createCli({ name: "duru" })
      .use(cliGateway(gatewayOptions, { namespace: "targets" }))
      .subCommand("targets", createGatewayCli(gatewayOptions, { group: "Gateway" }));

    const add = await cli.run(["targets", "add", "test-service", "run", "--type", "cli"], { render: false });
    const run = await cli.run(["targets", "test-service", "tools"], { render: false });

    expect(add.result).toEqual({ name: "test-service", type: "cli" });
    expect(run.result).toEqual({ command: "run", argv: ["tools"] });
  });

  test("auto-detects gateway target type during add", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    await cli.run(["gateway", "add", "say", "echo"], { render: false });
    await cli.run(["gateway", "add", "notes-api", "https://api.example.com"], { render: false });
    await cli.run(["gateway", "add", "openapi-spec", "https://api.example.com/openapi.json"], { render: false });
    await cli.run(["gateway", "add", "search-api", "https://api.example.com/graphql"], { render: false });
    await cli.run(["gateway", "add", "catservice", "https://catservice.example.com/mcp"], { render: false });
    await cli.run(["gateway", "add", "grpc-api", "localhost:50051"], { render: false });

    expect(await store.listTargets()).toEqual([
      { name: "catservice", type: "mcp", config: { url: "https://catservice.example.com/mcp" } },
      { name: "grpc-api", type: "grpc", config: { address: "localhost:50051" } },
      { name: "notes-api", type: "api", config: { baseUrl: "https://api.example.com" } },
      { name: "openapi-spec", type: "api", config: { openapiUrl: "https://api.example.com/openapi.json" } },
      { name: "say", type: "cli", config: { command: "echo", args: [] } },
      { name: "search-api", type: "graphql", config: { endpoint: "https://api.example.com/graphql" } },
    ]);
  });

  test("reports ambiguous add detection when multiple adapters match", async () => {
    const store = createMemoryGatewayStore();
    const adapter = (type: string) =>
      ({
        type,
        schema: { parse: (value: unknown) => value },
        detect: () => true,
        async add() {
          return {};
        },
        createTarget({ manifest, config }) {
          return {
            name: manifest.name,
            type: manifest.type,
            config,
            async invoke() {
              return { ok: true };
            },
          };
        },
      }) satisfies GatewayAdapter;
    const cli = createGatewayTestCli({ store, adapters: [adapter("api"), adapter("mcp")] });

    const result = await cli.run(["gateway", "add", "test-service", "https://api.example.com"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: "Gateway target type is ambiguous: api, mcp" });
  });

  test("registers list and remove commands backed by the injected store", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        { name: "test-service", type: "cli", config: { command: "test-service" } },
        { name: "notes-api", type: "openapi", config: { url: "https://api.example.com" } },
      ],
    });
    const cli = createGatewayTestCli({ store });

    const listBefore = await cli.run(["gateway", "list"], { render: false });
    const remove = await cli.run(["gateway", "remove", "test-service"], { render: false });
    const listAfter = await cli.run(["gateway", "list"], { render: false });

    expect(listBefore.result).toEqual([
      { name: "notes-api", type: "openapi" },
      { name: "test-service", type: "cli" },
    ]);
    expect(remove.result).toEqual({ removed: "test-service" });
    expect(listAfter.result).toEqual([{ name: "notes-api", type: "openapi" }]);
  });

  test("registers bind commands and dispatches bindings through the gateway runtime", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "say", type: "cli", config: { command: "echo" } }],
    });
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    const bind = await cli.run(["gateway", "bind", "hi", "say", "hello"], { render: false });
    const list = await cli.run(["gateway", "binds"], { render: false });
    const run = await cli.run(["hi", "example"], { render: false });
    const unbind = await cli.run(["gateway", "unbind", "hi"], { render: false });

    expect(bind.result).toEqual({ name: "hi", target: "say", args: ["hello"] });
    expect(list.result).toEqual([{ name: "hi", target: "say", args: ["hello"] }]);
    expect(run.result).toBe("hello example");
    expect(unbind.result).toEqual({ removed: "hi" });
    expect(await store.listBindings()).toEqual([]);
  });

  test("reports stable remove errors when a target does not exist", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store });

    const result = await cli.run(["gateway", "remove", "missing-target"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway target: "missing-target"' });
  });

  test("reports stable add errors when no adapter can handle a target type", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store });

    const result = await cli.run(["gateway", "add", "test-service", "--type", "missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway adapter type: "missing"' });
  });

  test("registers alias commands backed by the injected store", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createGatewayTestCli({ store });

    const add = await cli.run(["gateway", "alias", "add", "test-service", "cats", "listCats", "--limit", "10"], {
      render: false,
    });
    const list = await cli.run(["gateway", "alias", "list", "test-service"], { render: false });
    const remove = await cli.run(["gateway", "alias", "remove", "test-service", "cats"], { render: false });

    expect(add.result).toEqual({ target: "test-service", name: "cats", operation: "listCats" });
    expect(list.result).toEqual([
      { target: "test-service", name: "cats", operation: "listCats", args: ["--limit", "10"] },
    ]);
    expect(remove.result).toEqual({ removed: { target: "test-service", name: "cats" } });
    expect(await store.listAliases("test-service")).toEqual([]);
  });

  test("registers aliases with JSON object input and expands it before alias args", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const add = await cli.run(
      [
        "gateway",
        "alias",
        "add",
        "test-service",
        "cats",
        "listCats",
        "--input-json",
        '{"tag":"test-service","limit":20}',
        "--limit",
        "10",
      ],
      { render: false },
    );
    const list = await cli.run(["gateway", "alias", "list", "test-service"], { render: false });
    const run = await cli.run(["test-service", "cats", "--tag", "example"], { render: false });

    expect(add.result).toEqual({ target: "test-service", name: "cats", operation: "listCats" });
    expect(list.result).toEqual([
      {
        target: "test-service",
        name: "cats",
        operation: "listCats",
        input: { tag: "test-service", limit: 20 },
        args: ["--limit", "10"],
      },
    ]);
    expect(run.result).toEqual({
      command: "test-service",
      argv: ["listCats", '{"tag":"test-service","limit":20}', "--limit", "10", "--tag", "example"],
    });
  });

  test("registers profile commands backed by the injected store", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createGatewayTestCli({ store });

    const add = await cli.run(["gateway", "profile", "add", "test-service", "dev", "--prefix", "example"], {
      render: false,
    });
    const list = await cli.run(["gateway", "profile", "list", "test-service"], { render: false });
    const use = await cli.run(["gateway", "profile", "use", "test-service", "dev"], { render: false });
    const listActive = await cli.run(["gateway", "profile", "list", "test-service"], { render: false });
    const unset = await cli.run(["gateway", "profile", "unset", "test-service"], { render: false });
    const remove = await cli.run(["gateway", "profile", "remove", "test-service", "dev"], { render: false });

    expect(add.result).toEqual({ target: "test-service", name: "dev" });
    expect(list.result).toEqual([{ target: "test-service", name: "dev", config: { args: ["--prefix", "example"] } }]);
    expect(use.result).toEqual({ target: "test-service", name: "dev" });
    expect(listActive.result).toEqual([
      { target: "test-service", name: "dev", config: { args: ["--prefix", "example"] }, active: true },
    ]);
    expect(unset.result).toEqual({ target: "test-service", unset: "dev" });
    expect(remove.result).toEqual({ removed: { target: "test-service", name: "dev" } });
    expect(await store.listProfiles("test-service")).toEqual([]);
    expect(await store.getTarget("test-service")).toEqual({
      name: "test-service",
      type: "cli",
      config: { command: "test-service" },
    });
  });

  test("registers auth, login, and logout commands backed by adapter auth hooks", async () => {
    const calls: Array<{ action: string; config: { url: string }; ctx: { target: string; profile?: string } }> = [];
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { url: "https://api.example.com" } }],
    });
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          return value as { url: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: true };
          },
          auth: {
            async status(ctx) {
              calls.push({ action: "status", config, ctx });
              return { authenticated: true, label: "example-token" };
            },
            async login(ctx) {
              calls.push({ action: "login", config, ctx });
            },
            async logout(ctx) {
              calls.push({ action: "logout", config, ctx });
            },
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const status = await cli.run(["gateway", "auth", "notes-api"], { render: false });
    const login = await cli.run(["gateway", "login", "notes-api"], { render: false });
    const logout = await cli.run(["gateway", "logout", "notes-api"], { render: false });

    expect(status.result).toEqual({
      target: "notes-api",
      type: "api",
      action: "status",
      authenticated: true,
      label: "example-token",
    });
    expect(login.result).toEqual({ target: "notes-api", type: "api", action: "login" });
    expect(logout.result).toEqual({ target: "notes-api", type: "api", action: "logout" });
    expect(calls).toEqual([
      { action: "status", config: { url: "https://api.example.com" }, ctx: { target: "notes-api" } },
      { action: "login", config: { url: "https://api.example.com" }, ctx: { target: "notes-api" } },
      { action: "logout", config: { url: "https://api.example.com" }, ctx: { target: "notes-api" } },
    ]);
  });

  test("reports stable auth command errors for unsupported adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    const result = await cli.run(["gateway", "auth", "test-service"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Gateway adapter "cli" does not support status' });
  });

  test("registers refresh command that persists adapter-updated config", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "notes-api",
          type: "api",
          config: { url: "https://api.example.com", version: 1 },
          timeoutMs: 30000,
        },
      ],
    });
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          return value as { url: string; version: number };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: true };
          },
          async refresh(ctx) {
            return { config: { ...config, refreshedTarget: ctx.target, version: config.version + 1 } };
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string; version: number }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "refresh", "notes-api"], { render: false });

    expect(result.result).toEqual({ target: "notes-api", type: "api", refreshed: true, updated: true });
    expect(await store.getTarget("notes-api")).toEqual({
      name: "notes-api",
      type: "api",
      config: { url: "https://api.example.com", refreshedTarget: "notes-api", version: 2 },
      timeoutMs: 30000,
    });
  });

  test("registers refresh command that persists catalog snapshots", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { url: "https://api.example.com" } }],
    });
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          return value as { url: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: true };
          },
          async catalog() {
            return [{ name: "listItems", description: "List items" }];
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "refresh", "notes-api"], { render: false });
    const catalog = await store.getCatalog?.("notes-api");

    expect(result.result).toEqual({ target: "notes-api", type: "api", refreshed: true, updated: false });
    expect(catalog?.target).toBe("notes-api");
    expect(catalog?.operations).toEqual([{ name: "listItems", description: "List items" }]);
    expect(typeof catalog?.refreshedAt).toBe("string");
  });

  test("reports stable refresh command errors for unsupported adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createGatewayTestCli({ store, adapters: defaultGatewayAdapters() });

    const result = await cli.run(["gateway", "refresh", "test-service"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Gateway adapter "cli" does not support refresh' });
  });

  test("registers inspect command that reports gateway target capabilities", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { url: "https://api.example.com" } }],
      profiles: [
        {
          target: "notes-api",
          name: "dev",
          config: { headers: { "X-Custom-Header": "custom-from-config" } },
        },
      ],
    });
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          return value as { url: string; headers?: Record<string, string> };
        },
      },
      createTarget({ manifest, config, profile }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          profile: profile?.name,
          async invoke() {
            return { ok: true, value: config };
          },
          async catalog() {
            return [{ name: "listItems", description: "List items" }];
          },
          async refresh() {
            return { config };
          },
          auth: {
            async status() {
              return { authenticated: true };
            },
            async login() {},
          },
          async check() {
            return { diagnostics: [] };
          },
          listRow() {
            return { name: manifest.name, type: manifest.type, summary: config.url };
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string; headers?: Record<string, string> }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "inspect", "notes-api@dev"], { render: false });

    expect(result.result).toEqual({
      ok: true,
      target: {
        name: "notes-api",
        type: "api",
        profile: "dev",
        config: { redacted: true },
        registered: true,
        summary: "https://api.example.com",
        capabilities: {
          invoke: true,
          catalog: true,
          refresh: true,
          auth: { status: true, login: true, logout: false },
          complete: false,
          check: true,
        },
        operations: [{ name: "listItems", description: "List items" }],
      },
      diagnostics: [],
    });
  });

  test("reports unregistered gateway target types during inspect", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { url: "https://api.example.com" } }],
    });
    const cli = createGatewayTestCli({ store, adapters: [] });

    const result = await cli.run(["gateway", "inspect", "notes-api"], { render: false });

    expect(result.result).toEqual({
      ok: false,
      target: {
        name: "notes-api",
        type: "api",
        config: { redacted: true },
        registered: false,
        capabilities: { invoke: false, catalog: false, refresh: false, complete: false, check: false },
        operations: [],
      },
      diagnostics: [
        {
          severity: "error",
          code: "target.type.unregistered",
          message: 'Unknown gateway adapter type: "api"',
          path: ["type"],
        },
      ],
    });
  });

  test("registers check command that validates stored gateway targets", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        { name: "notes-api", type: "api", config: { url: "https://api.example.com" } },
        { name: "search-api", type: "api", config: {} },
        { name: "test-service", type: "mcp", config: { url: "https://api.example.com" } },
      ],
    });
    const adapter = {
      type: "api",
      schema: {
        parse(value: unknown) {
          if (!isRecord(value) || typeof value.url !== "string") {
            throw new Error("url is required");
          }
          return value as { url: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: true, value: config };
          },
          async check() {
            return {
              diagnostics:
                manifest.name === "notes-api"
                  ? [{ severity: "info" as const, code: "api.config.ok", message: "API target config is valid" }]
                  : [],
            };
          },
        };
      },
    } satisfies GatewayAdapter<{ url: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "check"], { render: false });

    expect(result.result).toEqual({
      ok: false,
      scope: "gateway",
      adapters: ["api"],
      targets: [
        {
          name: "notes-api",
          type: "api",
          ok: true,
          diagnostics: [{ severity: "info", code: "api.config.ok", message: "API target config is valid" }],
        },
        {
          name: "search-api",
          type: "api",
          ok: false,
          diagnostics: [
            {
              severity: "error",
              code: "target.config.invalid",
              message: "url is required",
              path: ["targets", "search-api", "config"],
            },
          ],
        },
        {
          name: "test-service",
          type: "mcp",
          ok: false,
          diagnostics: [
            {
              severity: "error",
              code: "target.type.unregistered",
              message: 'Unknown gateway adapter type: "mcp"',
              path: ["targets", "test-service", "type"],
            },
          ],
        },
      ],
      diagnostics: [
        { severity: "info", code: "api.config.ok", message: "API target config is valid" },
        {
          severity: "error",
          code: "target.config.invalid",
          message: "url is required",
          path: ["targets", "search-api", "config"],
        },
        {
          severity: "error",
          code: "target.type.unregistered",
          message: 'Unknown gateway adapter type: "mcp"',
          path: ["targets", "test-service", "type"],
        },
      ],
    });
  });
});

describe("@duru/cli-gateway runtime", () => {
  test("dispatches unknown commands as target invocations through matching adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "tools"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "test-service", argv: ["tools"] });
  });

  test("dispatches root target invocations through kit route middleware", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const events: string[] = [];
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] }).use("test-service", async (ctx, next) => {
      events.push(ctx.request.positionals.join(" "));
      return next();
    });

    const result = await cli.run(["test-service", "tools"], { render: false });

    expect(result.result).toEqual({ command: "test-service", argv: ["tools"] });
    expect(events).toEqual(["test-service tools"]);
  });

  test("registers catalog operations as scoped kit routes", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
      catalogs: [{ target: "test-service", operations: [{ name: "listCats", description: "List cats" }] }],
    });
    const events: string[] = [];
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] }).use("test-service listCats", async (ctx, next) => {
      events.push(ctx.request.positionals.join(" "));
      return next();
    });

    const result = await cli.run(["test-service", "listCats", "limit=10"], { render: false });

    expect(result.result).toEqual({ command: "test-service", argv: ["listCats", "limit=10"] });
    expect(events).toEqual(["test-service listCats limit=10"]);
  });

  test("dispatches gateway-prefixed target invocations through matching adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gateway", "test-service", "tools"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "test-service", argv: ["tools"] });
  });

  test("dispatches gateway-prefixed target invocations through kit route middleware", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const events: string[] = [];
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] }).use("gateway test-service", async (ctx, next) => {
      events.push(ctx.request.positionals.join(" "));
      return next();
    });

    const result = await cli.run(["gateway", "test-service", "tools"], { render: false });

    expect(result.result).toEqual({ command: "test-service", argv: ["tools"] });
    expect(events).toEqual(["gateway test-service tools"]);
  });

  test("registers gateway-prefixed catalog operations as scoped kit routes", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
      catalogs: [{ target: "test-service", operations: [{ name: "listCats", description: "List cats" }] }],
    });
    const events: string[] = [];
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] }).use(
      "gateway test-service listCats",
      async (ctx, next) => {
        events.push(ctx.request.positionals.join(" "));
        return next();
      },
    );

    const result = await cli.run(["gateway", "test-service", "listCats"], { render: false });

    expect(result.result).toEqual({ command: "test-service", argv: ["listCats"] });
    expect(events).toEqual(["gateway test-service listCats"]);
  });

  test("keeps root target aliases available even when target names match gateway commands", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "list", type: "cli", config: { command: "list" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const direct = await cli.run(["list", "tools"], { render: false });
    const managed = await cli.run(["gateway", "list"], { render: false });

    expect(direct.result).toEqual({ command: "list", argv: ["tools"] });
    expect(managed.result).toEqual([{ name: "list", type: "cli" }]);
  });

  test("passes gateway target help through before static help middleware", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createCli({ name: "duru" })
      .use(cliGateway({ store, adapters: [adapter] }))
      .use(help());

    const result = await cli.run(["test-service", "--help"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "test-service", argv: ["--help"] });
  });

  test("passes gateway-prefixed target help through before static help middleware", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createCli({ name: "duru" })
      .use(cliGateway({ store, adapters: [adapter] }))
      .use(help());

    const result = await cli.run(["gateway", "test-service", "--help"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "test-service", argv: ["--help"] });
  });

  test("handles gateway-prefixed mcp target help before static help middleware", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "catservice", type: "mcp", config: { url: "https://catservice.example.com/mcp" } }],
    });
    const gatewayOptions = {
      store,
      adapters: defaultGatewayAdapters(),
      services: {
        async fetch() {
          return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }), {
            status: 200,
            statusText: "OK",
            headers: { "content-type": "application/json" },
          });
        },
      },
    };
    const cli = createCli({ name: "duru" })
      .use(cliGateway(gatewayOptions))
      .subCommand("gateway", createGatewayCli(gatewayOptions, { group: "Gateway" }))
      .use(help());

    const result = await cli.run(["gateway", "catservice", "--help"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toContain("Usage: catservice <tool|method>");
    expect(result.result).toContain("Target: catservice (mcp)");
  });

  test("leaves ordinary unknown commands to the host cli when no target matches", async () => {
    const store = createMemoryGatewayStore();
    const cli = createGatewayTestCli({ store });

    const result = await cli.run(["missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({ message: "Unknown command: missing" });
  });

  test("reports target invocation errors when the target type has no adapter", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "openapi", config: { url: "https://api.example.com" } }],
    });
    const cli = createGatewayTestCli({ store });

    const result = await cli.run(["notes-api", "listItems"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway adapter type: "openapi"' });
  });

  test("preserves failing adapter exit codes and errors", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke() {
            return { ok: false, error: { message: "denied" }, exitCode: 7 };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "delete"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(7);
    expect(result.result).toEqual({ message: "denied" });
  });

  test("passes target timeout signals into adapter invocation", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" }, timeoutMs: 1000 }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { hasSignal: Boolean(ctx.signal), aborted: ctx.signal?.aborted ?? false } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "listCats"], { render: false });

    expect(result.result).toEqual({ hasSignal: true, aborted: false });
  });

  test("passes gateway dry-run option into adapter invocation", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { argv: ctx.argv, dryRun: ctx.dryRun ?? false } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "listCats", "--dry-run"], { render: false });

    expect(result.result).toEqual({ argv: ["listCats"], dryRun: true });
  });

  test("redacts resolved secret refs in gateway dry-run output", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "secret-api",
          type: "api",
          config: {
            baseUrl: "https://api.example.com",
            headers: { Authorization: "keychain://api/token", "X-Plain": "visible" },
          },
        },
      ],
    });
    const resolver = createResolver([secretProvider("keychain", { "api/token": "super-secret" })]);
    const cli = createGatewayTestCli({
      store,
      adapters: defaultGatewayAdapters(),
      services: { secrets: resolver },
    });

    const result = await cli.run(["secret-api", "/v1/items", "--dry-run"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toMatchObject({
      request: {
        headers: { Authorization: "<redacted>", "X-Plain": "visible" },
      },
    });
    expect(JSON.stringify(result.result)).not.toContain("super-secret");
  });

  test("expands target aliases before adapter execution", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
      aliases: [
        {
          target: "test-service",
          name: "cats",
          operation: "listCats",
          args: ["--limit", "10"],
        },
      ],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "cats", "--verbose"], { render: false });

    expect(result.result).toEqual({
      command: "test-service",
      argv: ["listCats", "--limit", "10", "--verbose"],
    });
  });

  test("enforces target allow and deny rules after alias expansion", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "test-service",
          type: "cli",
          config: { command: "test-service" },
          allow: ["listCats"],
          deny: ["deleteCats"],
        },
      ],
      aliases: [{ target: "test-service", name: "cats", operation: "listCats" }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const allowed = await cli.run(["test-service", "cats"], { render: false });
    const denied = await cli.run(["test-service", "deleteCats"], { render: false });
    const notAllowed = await cli.run(["test-service", "updateCats"], { render: false });

    expect(allowed.result).toEqual({ command: "test-service", argv: ["listCats"] });
    expect(denied.ok).toBe(false);
    expect(denied.exitCode).toBe(2);
    expect(denied.result).toEqual({ message: 'Gateway target "test-service" denied operation: "deleteCats"' });
    expect(notAllowed.ok).toBe(false);
    expect(notAllowed.exitCode).toBe(2);
    expect(notAllowed.result).toEqual({
      message: 'Gateway target "test-service" does not allow operation: "updateCats"',
    });
  });

  test("allows gateway introspection commands regardless of target ACL", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "gh", type: "cli", config: { command: "gh" }, allow: ["issue"] }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { command: config.command, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["gh", "tools"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "gh", argv: ["tools"] });
  });

  test("merges target profiles before adapter execution", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service", args: ["base"] } }],
      profiles: [
        {
          target: "test-service",
          name: "dev",
          config: { args: ["profile"] },
        },
      ],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string; args?: readonly string[] };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { config, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string; args?: readonly string[] }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service@dev", "cats"], { render: false });

    expect(result.result).toEqual({
      config: { command: "test-service", args: ["profile"] },
      argv: ["cats"],
    });
  });

  test("uses default target profiles before adapter execution", async () => {
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "test-service",
          type: "cli",
          config: { command: "test-service", args: ["base"] },
          defaultProfile: "dev",
        },
      ],
      profiles: [{ target: "test-service", name: "dev", config: { args: ["profile"] } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string; args?: readonly string[] };
        },
      },
      createTarget({ manifest, config, profile }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          profile: profile?.name,
          async invoke(ctx) {
            return { ok: true, value: { config, profile: profile?.name, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string; args?: readonly string[] }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service", "cats"], { render: false });

    expect(result.result).toEqual({
      config: { command: "test-service", args: ["profile"] },
      profile: "dev",
      argv: ["cats"],
    });
  });

  test("reports missing explicit target profiles", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const adapter = {
      type: "cli",
      schema: {
        parse(value: unknown) {
          return value as { command: string };
        },
      },
      createTarget({ manifest, config }) {
        return {
          name: manifest.name,
          type: manifest.type,
          config,
          async invoke(ctx) {
            return { ok: true, value: { config, argv: ctx.argv } };
          },
        };
      },
    } satisfies GatewayAdapter<{ command: string }>;
    const cli = createGatewayTestCli({ store, adapters: [adapter] });

    const result = await cli.run(["test-service@missing", "cats"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway profile: "test-service@missing"' });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createGatewayTestCli(options: CliGatewayOptions) {
  return createCli({ name: "duru" })
    .use(cliGateway(options))
    .subCommand("gateway", createGatewayCli(options, { group: "Gateway" }));
}

function secretProvider(scheme: string, values: Record<string, string>): SecretProvider {
  const store = new Map(Object.entries(values));
  return {
    scheme,
    async get(path) {
      return store.get(path);
    },
    async set(path, value) {
      store.set(path, value);
    },
    async delete(path) {
      store.delete(path);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
