import { describe, expect, test } from "bun:test";
import {
  type GatewayAdapter,
  type GatewayContext,
  type GatewayResult,
  cliGateway,
  createMemoryGatewayStore,
  defaultGatewayAdapters,
} from "@clip/cli-gateway";
import { createCli } from "@clip/kit";

describe("@clip/cli-gateway contract", () => {
  test("creates an installable plugin without owning persistence", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

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
    const context: GatewayContext = { store, env: { CLIP_HOME: "test-home" } };
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
              value: { command: config.command, argv: ctx.argv, home: context.env?.CLIP_HOME },
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

describe("@clip/cli-gateway commands", () => {
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["add", "test-service", "run", "cats", "--type", "cli"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "test-service", type: "cli" });
    expect(await store.getTarget("test-service")).toEqual({
      name: "test-service",
      type: "cli",
      config: { command: "run", args: ["cats"] },
    });
  });

  test("auto-detects gateway target type during add", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: defaultGatewayAdapters() }));

    await cli.run(["add", "say", "echo"], { render: false });
    await cli.run(["add", "notes-api", "https://api.example.com"], { render: false });
    await cli.run(["add", "openapi-spec", "https://api.example.com/openapi.json"], { render: false });
    await cli.run(["add", "search-api", "https://api.example.com/graphql"], { render: false });
    await cli.run(["add", "catservice", "https://catservice.example.com/mcp"], { render: false });
    await cli.run(["add", "grpc-api", "localhost:50051"], { render: false });

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter("api"), adapter("mcp")] }));

    const result = await cli.run(["add", "test-service", "https://api.example.com"], { render: false });

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const listBefore = await cli.run(["list"], { render: false });
    const remove = await cli.run(["remove", "test-service"], { render: false });
    const listAfter = await cli.run(["list"], { render: false });

    expect(listBefore.result).toEqual({
      targets: [
        { name: "notes-api", type: "openapi" },
        { name: "test-service", type: "cli" },
      ],
    });
    expect(remove.result).toEqual({ removed: "test-service" });
    expect(listAfter.result).toEqual({ targets: [{ name: "notes-api", type: "openapi" }] });
  });

  test("reports stable remove errors when a target does not exist", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const result = await cli.run(["remove", "missing-target"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway target: "missing-target"' });
  });

  test("reports stable add errors when no adapter can handle a target type", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const result = await cli.run(["add", "test-service", "--type", "missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway adapter type: "missing"' });
  });

  test("registers alias commands backed by the injected store", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const add = await cli.run(["alias", "add", "test-service", "cats", "listCats", "--limit", "10"], {
      render: false,
    });
    const list = await cli.run(["alias", "list", "test-service"], { render: false });
    const remove = await cli.run(["alias", "remove", "test-service", "cats"], { render: false });

    expect(add.result).toEqual({ target: "test-service", name: "cats", operation: "listCats" });
    expect(list.result).toEqual({
      aliases: [{ target: "test-service", name: "cats", operation: "listCats", args: ["--limit", "10"] }],
    });
    expect(remove.result).toEqual({ removed: { target: "test-service", name: "cats" } });
    expect(await store.listAliases("test-service")).toEqual([]);
  });

  test("registers profile commands backed by the injected store", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const add = await cli.run(["profile", "add", "test-service", "dev", "--prefix", "example"], {
      render: false,
    });
    const list = await cli.run(["profile", "list", "test-service"], { render: false });
    const remove = await cli.run(["profile", "remove", "test-service", "dev"], { render: false });

    expect(add.result).toEqual({ target: "test-service", name: "dev" });
    expect(list.result).toEqual({
      profiles: [{ target: "test-service", name: "dev", config: { args: ["--prefix", "example"] } }],
    });
    expect(remove.result).toEqual({ removed: { target: "test-service", name: "dev" } });
    expect(await store.listProfiles("test-service")).toEqual([]);
  });

  test("registers login and logout commands backed by adapter auth hooks", async () => {
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const login = await cli.run(["login", "notes-api"], { render: false });
    const logout = await cli.run(["logout", "notes-api"], { render: false });

    expect(login.result).toEqual({ target: "notes-api", type: "api", action: "login" });
    expect(logout.result).toEqual({ target: "notes-api", type: "api", action: "logout" });
    expect(calls).toEqual([
      { action: "login", config: { url: "https://api.example.com" }, ctx: { target: "notes-api" } },
      { action: "logout", config: { url: "https://api.example.com" }, ctx: { target: "notes-api" } },
    ]);
  });

  test("reports stable auth command errors for unsupported adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: defaultGatewayAdapters() }));

    const result = await cli.run(["login", "test-service"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Gateway adapter "cli" does not support login' });
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["refresh", "notes-api"], { render: false });

    expect(result.result).toEqual({ target: "notes-api", type: "api", refreshed: true, updated: true });
    expect(await store.getTarget("notes-api")).toEqual({
      name: "notes-api",
      type: "api",
      config: { url: "https://api.example.com", refreshedTarget: "notes-api", version: 2 },
      timeoutMs: 30000,
    });
  });

  test("reports stable refresh command errors for unsupported adapters", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "test-service", type: "cli", config: { command: "test-service" } }],
    });
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: defaultGatewayAdapters() }));

    const result = await cli.run(["refresh", "test-service"], { render: false });

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["inspect", "notes-api@dev"], { render: false });

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [] }));

    const result = await cli.run(["inspect", "notes-api"], { render: false });

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["check"], { render: false });

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

describe("@clip/cli-gateway runtime", () => {
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["test-service", "tools"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ command: "test-service", argv: ["tools"] });
  });

  test("leaves ordinary unknown commands to the host cli when no target matches", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const result = await cli.run(["missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.result).toEqual({ message: "Unknown command: missing" });
  });

  test("reports target invocation errors when the target type has no adapter", async () => {
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "openapi", config: { url: "https://api.example.com" } }],
    });
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["test-service", "listCats", "--dry-run"], { render: false });

    expect(result.result).toEqual({ argv: ["listCats"], dryRun: true });
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["test-service@dev", "cats"], { render: false });

    expect(result.result).toEqual({
      config: { command: "test-service", args: ["profile"] },
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
    const cli = createCli({ name: "clip" }).use(cliGateway({ store, adapters: [adapter] }));

    const result = await cli.run(["test-service@missing", "cats"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway profile: "test-service@missing"' });
  });
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
