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

    expect(defaultGatewayAdapters()).toEqual([]);
    expect(result.ok).toBe(false);
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

  test("reports stable add errors when no adapter can handle a target type", async () => {
    const store = createMemoryGatewayStore();
    const cli = createCli({ name: "clip" }).use(cliGateway({ store }));

    const result = await cli.run(["add", "test-service", "--type", "missing"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway adapter type: "missing"' });
  });
});
