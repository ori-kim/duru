import { describe, expect, test } from "bun:test";
import { createCli, createPlugin } from "@duru/cli-kit";
import type { CliPluginApi } from "@duru/cli-kit";
import { cliGateway, createGatewayCli, createMemoryGatewayStore, defaultGatewayAdapters } from "../index";
import type { GatewayAdapter, GatewayResult } from "../types";

describe("@duru/cli-gateway completion", () => {
  test("contributes target, profile, binding, alias, and operation candidates without secrets", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    const store = createMemoryGatewayStore({
      targets: [
        {
          name: "notes-api",
          type: "api",
          defaultProfile: "dev",
          config: { auth: { provider: "oauth", token: "dummy-token" } },
        },
      ],
      profiles: [
        { target: "notes-api", name: "dev", config: { baseUrl: "https://api.example.com" } },
        { target: "notes-api", name: "prod", config: { baseUrl: "https://api.example.com" } },
      ],
      aliases: [{ target: "notes-api", name: "cats", operation: "listCats" }],
      bindings: [{ name: "notes", target: "notes-api", profile: "dev" }],
    });
    const adapter = fakeAdapter();
    const capture = createPlugin((api) => {
      complete = api.complete;
    });
    const cli = createCli({ name: "duru" })
      .use(cliGateway({ store, adapters: [adapter] }))
      .subCommand("gateway", createGatewayCli({ store, adapters: [adapter] }, { group: "Gateway" }))
      .use(capture);

    cli.command("noop", "Noop").action(() => undefined);

    const root = await complete?.(completionContext([""]));
    const profile = await complete?.(completionContext(["login", "notes-api@"]));
    const target = await complete?.(completionContext(["notes-api", ""]));
    const gatewayTarget = await complete?.(completionContext(["gateway", ""]));
    const gatewayOperation = await complete?.(completionContext(["gateway", "notes-api", ""]));
    const text = JSON.stringify([root, profile, target]);

    expect(root?.items).toContainEqual({
      value: "notes-api",
      description: "api target",
      kind: "target",
      group: "api-targets",
    });
    expect(root?.items).toContainEqual({
      value: "notes",
      description: "notes-api@dev binding",
      kind: "alias",
      group: "gateway bindings",
    });
    expect(profile?.items).toContainEqual({
      value: "notes-api@dev",
      description: "active profile",
      kind: "profile",
      group: "gateway profiles",
    });
    expect(target?.items).toContainEqual({
      value: "cats",
      description: "alias for listCats",
      kind: "alias",
      group: "gateway aliases",
    });
    expect(target?.items).toContainEqual({
      value: "listCats",
      description: "List cats",
      kind: "operation",
      group: "gateway operations",
    });
    expect(gatewayTarget?.items).toContainEqual({
      value: "notes-api",
      description: "api target",
      kind: "target",
      group: "api-targets",
    });
    expect(gatewayOperation?.items).toContainEqual({
      value: "listCats",
      description: "List cats",
      kind: "operation",
      group: "gateway operations",
    });
    expect(text).not.toContain("dummy-token");
  });

  test("uses the configured namespace for gateway target completion", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: {} }],
    });
    const adapter = fakeAdapter();
    const gatewayOptions = { store, adapters: [adapter] };
    const capture = createPlugin((api) => {
      complete = api.complete;
    });
    createCli({ name: "duru" })
      .use(cliGateway(gatewayOptions, { namespace: "targets" }))
      .subCommand("targets", createGatewayCli(gatewayOptions, { group: "Gateway" }))
      .use(capture);

    const target = await complete?.(completionContext(["targets", ""]));

    expect(target?.items).toContainEqual({
      value: "notes-api",
      description: "api target",
      kind: "target",
      group: "api-targets",
    });
  });

  test("uses cached catalog snapshots for operation completion", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    let catalogCalls = 0;
    const store = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: {} }],
      catalogs: [{ target: "notes-api", operations: [{ name: "listItems", description: "List items" }] }],
    });
    const adapter = {
      ...fakeAdapter(),
      createTarget(input) {
        const target = fakeAdapter().createTarget(input);
        return {
          ...target,
          async catalog() {
            catalogCalls += 1;
            return [{ name: "staleItems", description: "Stale items" }];
          },
        };
      },
    } satisfies GatewayAdapter<Record<string, unknown>>;
    const capture = createPlugin((api) => {
      complete = api.complete;
    });
    createCli({ name: "duru" })
      .use(cliGateway({ store, adapters: [adapter] }))
      .subCommand("gateway", createGatewayCli({ store, adapters: [adapter] }, { group: "Gateway" }))
      .use(capture);

    const result = await complete?.(completionContext(["notes-api", ""]));

    expect(result?.items).toContainEqual({
      value: "listItems",
      description: "List items",
      kind: "operation",
      group: "gateway operations",
    });
    expect(result?.items.some((item) => item.value === "staleItems")).toBe(false);
    expect(catalogCalls).toBe(0);
  });

  test("completes MCP tools discovered from SSE catalog responses", async () => {
    let complete: CliPluginApi["complete"] | undefined;
    const store = createMemoryGatewayStore({
      targets: [{ name: "catservice", type: "mcp", config: { url: "https://catservice.example.com/mcp" } }],
    });
    const gatewayOptions = {
      store,
      adapters: defaultGatewayAdapters(),
      services: {
        async fetch() {
          return new Response(
            ["event: message", 'data: {"result":{"tools":[{"name":"listCats","description":"List cats"}]}}', ""].join(
              "\n",
            ),
            {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "text/event-stream" },
            },
          );
        },
      },
    };
    const capture = createPlugin((api) => {
      complete = api.complete;
    });
    createCli({ name: "duru" })
      .use(cliGateway(gatewayOptions))
      .subCommand("gateway", createGatewayCli(gatewayOptions, { group: "Gateway" }))
      .use(capture);

    const result = await complete?.(completionContext(["gateway", "catservice", ""]));

    expect(result?.items).toContainEqual({
      value: "listCats",
      description: "List cats",
      kind: "operation",
      group: "gateway operations",
    });
  });
});

function completionContext(argv: readonly string[]) {
  const position = Math.max(0, argv.length - 1);
  return {
    argv,
    cursor: argv.length,
    current: argv[position] ?? "",
    previous: position > 0 ? argv[position - 1] : undefined,
    position,
  };
}

function fakeAdapter(): GatewayAdapter<Record<string, unknown>> {
  return {
    type: "api",
    schema: {
      parse(value) {
        return value as Record<string, unknown>;
      },
    },
    createTarget({ manifest, config }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(): Promise<GatewayResult> {
          return { ok: true, exitCode: 0 };
        },
        async catalog() {
          return [{ name: "listCats", description: "List cats" }];
        },
      };
    },
  };
}
