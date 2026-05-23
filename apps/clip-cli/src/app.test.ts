import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppCli } from "./app.ts";

describe("clip-cli demo app", () => {
  test("renders text output by default", async () => {
    const result = await createAppCli().run(["hello", "example", "--uppercase"]);

    expect(result.exitCode).toBe(0);
    expect(result.rendered?.stdout).toBe("hello EXAMPLE\n");
  });

  test("can render command output as json", async () => {
    const result = await createAppCli().run(["inspect", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.rendered?.stdout).toContain('"app": "clip-cli"');
  });

  test("renders command json presenters without output envelopes", async () => {
    const result = await createAppCli().run(["hello", "example", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({ greeting: "hello example" });
  });

  test("runs nested router commands", async () => {
    const result = await createAppCli().run(["ext", "registry", "add", "example"]);

    expect(result.exitCode).toBe(0);
    expect(result.value).toEqual({ registry: "example", status: "added" });
  });

  test("runs custom event observer demo", async () => {
    const result = await createAppCli().run(["events", "--json", "--events"]);

    expect(result.exitCode).toBe(0);
    expect(result.value).toEqual({ observed: "event observer ran" });
    expect(JSON.parse(result.rendered?.stdout ?? "")).toEqual({
      result: { observed: "event observer ran" },
      events: [{ name: "log", payload: { message: "event observer ran" } }],
    });
  });

  test("shows gateway management under the gateway namespace in root help", async () => {
    const result = await createAppCli().run(["--help"]);
    const stdout = result.rendered?.stdout ?? "";

    expect(stdout).toContain("gateway add <name> [...args]  Add a gateway target");
    expect(stdout).toContain("gateway <target> [...args]  Run a gateway target");
    expect(stdout).not.toContain("\n    add <name> [...args]  Add a gateway target");
  });

  test("owns zsh completion routes and gateway styles at the app layer", async () => {
    const home = await tempDir("completion");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "catservice", "https://catservice.example.com/mcp"], {
        render: false,
      });

      const query = await createAppCli().run(["completion", "query", "--shell", "zsh", "--", "clip", "gateway", ""], {
        render: false,
      });
      const script = await createAppCli().run(["completion", "zsh", "--name", "clip-dev"], { render: false });

      expect(query.exitCode).toBe(0);
      expect(query.result).toMatchObject({
        items: expect.arrayContaining([
          { value: "catservice", description: "mcp target", kind: "target", group: "mcp-targets" },
        ]),
      });
      expect(script.result).toContain("compdef _clip_completion clip-dev");
      expect(script.result).toContain("zstyle ':completion:*:*:clip-dev:*:mcp-targets' list-colors '=*=33'");
      expect(script.result).toContain(
        "zstyle ':completion:*:*:clip-dev:*:gateway-operations' list-colors '=*=38;5;246'",
      );
    });
  });

  test("renders gateway mcp target help as text by default", async () => {
    const home = await tempDir("gateway-mcp-help");
    const previousFetch = globalThis.fetch;

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "catservice", "https://catservice.example.com/mcp"], {
        render: false,
      });
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { tools: [{ name: "listCats", description: "List cats" }] },
          }),
          { headers: { "content-type": "application/json" } },
        )) as unknown as typeof fetch;

      try {
        const result = await createAppCli().run(["gateway", "catservice", "--help"]);
        const stdout = result.rendered?.stdout ?? "";

        expect(result.exitCode).toBe(0);
        expect(stdout).toContain("Usage: catservice <tool|method>");
        expect(stdout).toContain("listCats");
        expect(stdout).toContain("List cats");
        expect(stdout).not.toStartWith("{");
      } finally {
        globalThis.fetch = previousFetch;
      }
    });
  });

  test("uses notFound observer output", async () => {
    const home = await tempDir("missing");
    const result = await withClipHome(home, () => createAppCli().run(["missing", "--json"]));

    expect(result.exitCode).toBe(1);
    expect(result.value).toEqual({
      error: { message: "Unknown command: missing --json" },
      hint: "Run clip --help",
    });
  });

  test("uses catch handler output", async () => {
    const result = await createAppCli().run(["fail", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.value).toEqual({
      error: { message: "demo failure" },
      hint: "The catch handler converted this failure",
    });
  });

  test("runs zod-backed command input examples", async () => {
    const result = await createAppCli().run(["call", "42", "--timeout-ms", "1500", "--dry-run"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ operation: 42, timeoutMs: 1500, dryRun: true });
  });

  test("runs command metadata alias examples", async () => {
    const result = await createAppCli().run(["meta", "pub", "notes"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ name: "notes", status: "published", dryRun: false });
  });

  test("runs explicit mount and partial path middleware examples", async () => {
    const result = await createAppCli().run(["tools", "echo", "hello"], { render: false });

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ value: "hello" });
    expect(result.events).toEqual([{ name: "log", payload: { message: "tools subtree", path: "tools echo hello" } }]);
  });

  test("runs route-level error boundary examples", async () => {
    const result = await createAppCli().run(["tools", "fail"], { render: false });

    expect(result.exitCode).toBe(4);
    expect(result.result).toEqual({ handledBy: "tools", message: "tool failure" });
  });

  test("runs command-level error boundary examples", async () => {
    const result = await createAppCli().run(["tools", "recover"], { render: false });

    expect(result.exitCode).toBe(3);
    expect(result.result).toEqual({ handledBy: "command", message: "recoverable failure" });
  });

  test("persists cli gateway targets in CLIP_HOME and dispatches them", async () => {
    const home = await tempDir("gateway");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });
      const list = await createAppCli().run(["gateway", "list"], { render: false });
      const run = await createAppCli().run(["say", "hello", "example"], { render: false });
      const config = await readFile(join(home, "gateway", "cli", "say", "config.toml"), "utf8");

      expect(add.exitCode).toBe(0);
      expect(add.result).toEqual({ name: "say", type: "cli" });
      expect(list.result).toEqual({ targets: [{ name: "say", type: "cli" }] });
      expect(run.exitCode).toBe(0);
      expect(run.result).toBe("hello example");
      expect(config).toContain('name = "say"');
      expect(config).toContain('type = "cli"');
      expect(config).toContain("[config]");
      expect(config).toContain('command = "echo"');
    });
  });

  test("persists script gateway targets in CLIP_HOME and dispatches them", async () => {
    const home = await tempDir("gateway-script");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(["gateway", "add", "say", "echo", "hello", "--type", "script"], {
        render: false,
      });
      const run = await createAppCli().run(["say", "example"], { render: false });
      const config = await readFile(join(home, "gateway", "script", "say", "config.toml"), "utf8");

      expect(add.result).toEqual({ name: "say", type: "script" });
      expect(run.result).toBe("hello example");
      expect(config).toContain('command = "echo"');
      expect(config).toContain("[config]");
    });
  });

  test("persists api gateway targets in CLIP_HOME", async () => {
    const home = await tempDir("gateway-api");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(
        ["gateway", "add", "notes-api", "https://api.example.com", "--type", "api"],
        {
          render: false,
        },
      );
      const check = await createAppCli().run(["gateway", "check"], { render: false });
      const config = await readFile(join(home, "gateway", "api", "notes-api", "config.toml"), "utf8");

      expect(add.result).toEqual({ name: "notes-api", type: "api" });
      expect(check.result).toEqual({
        ok: true,
        scope: "gateway",
        adapters: ["cli", "script", "api", "graphql", "mcp", "grpc"],
        targets: [{ name: "notes-api", type: "api", ok: true, diagnostics: [] }],
        diagnostics: [],
      });
      expect(config).toContain('baseUrl = "https://api.example.com"');
    });
  });

  test("loads migrated api sidecar OpenAPI specs from CLIP_HOME", async () => {
    const home = await tempDir("gateway-sidecar-spec");
    const targetDir = join(home, "gateway", "api", "notes-api");

    await mkdir(targetDir, { recursive: true });
    await writeFile(
      join(targetDir, "config.yml"),
      [
        "name: notes-api",
        "type: api",
        "baseUrl: https://api.example.com",
        "openapiUrl: https://api.example.com/openapi.json",
      ].join("\n"),
    );
    await writeFile(
      join(targetDir, "spec.json"),
      JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Notes API", version: "1.0.0" },
        paths: {
          "/v1/items": {
            get: {
              operationId: "listItems",
              description: "List items",
              responses: { "200": { description: "OK" } },
            },
          },
        },
      }),
    );

    const result = await withClipHome(home, () => createAppCli().run(["notes-api", "tools"], { render: false }));

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual([
      {
        name: "listItems",
        description: "List items",
        method: "GET",
        path: "/v1/items",
        inputSchema: { type: "object", properties: {} },
        pathParams: [],
        queryParams: [],
        headerParams: [],
      },
    ]);
  });

  test("persists graphql gateway targets in CLIP_HOME", async () => {
    const home = await tempDir("gateway-graphql");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(
        ["gateway", "add", "search-api", "https://api.example.com/graphql", "--type", "graphql"],
        { render: false },
      );
      const check = await createAppCli().run(["gateway", "check"], { render: false });
      const config = await readFile(join(home, "gateway", "graphql", "search-api", "config.toml"), "utf8");

      expect(add.result).toEqual({ name: "search-api", type: "graphql" });
      expect(check.result).toEqual({
        ok: true,
        scope: "gateway",
        adapters: ["cli", "script", "api", "graphql", "mcp", "grpc"],
        targets: [{ name: "search-api", type: "graphql", ok: true, diagnostics: [] }],
        diagnostics: [],
      });
      expect(config).toContain('endpoint = "https://api.example.com/graphql"');
    });
  });

  test("persists mcp gateway targets in CLIP_HOME", async () => {
    const home = await tempDir("gateway-mcp");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(
        ["gateway", "add", "catservice", "https://catservice.example.com/mcp", "--type", "mcp"],
        { render: false },
      );
      const check = await createAppCli().run(["gateway", "check"], { render: false });
      const config = await readFile(join(home, "gateway", "mcp", "catservice", "config.toml"), "utf8");

      expect(add.result).toEqual({ name: "catservice", type: "mcp" });
      expect(check.result).toEqual({
        ok: true,
        scope: "gateway",
        adapters: ["cli", "script", "api", "graphql", "mcp", "grpc"],
        targets: [{ name: "catservice", type: "mcp", ok: true, diagnostics: [] }],
        diagnostics: [],
      });
      expect(config).toContain('url = "https://catservice.example.com/mcp"');
    });
  });

  test("keeps app renderer options out of gateway target invocations", async () => {
    const home = await tempDir("gateway-renderer-options");

    await withClipHome(home, async () => {
      await createAppCli().run(
        ["gateway", "add", "catservice", "https://catservice.example.com/mcp", "--type", "mcp"],
        {
          render: false,
        },
      );

      const result = await createAppCli().run(["gateway", "catservice", "--dry-run", "--json"], { render: false });

      expect(result.exitCode).toBe(0);
      expect(result.result).toMatchObject({
        request: {
          url: "https://catservice.example.com/mcp",
          rpcMethod: "tools/list",
        },
      });
    });
  });

  test("keeps renderer-like options after gateway target operations", async () => {
    const home = await tempDir("gateway-target-options");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const result = await createAppCli().run(["say", "hello", "--json"], { render: false });

      expect(result.exitCode).toBe(0);
      expect(result.result).toBe("hello --json");
    });
  });

  test("persists grpc gateway targets in CLIP_HOME", async () => {
    const home = await tempDir("gateway-grpc");

    await withClipHome(home, async () => {
      const add = await createAppCli().run(["gateway", "add", "catservice", "localhost:50051", "--type", "grpc"], {
        render: false,
      });
      const check = await createAppCli().run(["gateway", "check"], { render: false });
      const config = await readFile(join(home, "gateway", "grpc", "catservice", "config.toml"), "utf8");

      expect(add.result).toEqual({ name: "catservice", type: "grpc" });
      expect(check.result).toEqual({
        ok: true,
        scope: "gateway",
        adapters: ["cli", "script", "api", "graphql", "mcp", "grpc"],
        targets: [{ name: "catservice", type: "grpc", ok: true, diagnostics: [] }],
        diagnostics: [],
      });
      expect(config).toContain('address = "localhost:50051"');
    });
  });

  test("reports missing gateway target removal as an error", async () => {
    const home = await tempDir("gateway-remove-missing");

    const result = await withClipHome(home, () =>
      createAppCli().run(["gateway", "remove", "missing-target"], { render: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({ message: 'Unknown gateway target: "missing-target"' });
  });

  test("reports unsupported gateway login as an error", async () => {
    const home = await tempDir("gateway-login-unsupported");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const result = await createAppCli().run(["gateway", "login", "say"], { render: false });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.result).toEqual({ message: 'Gateway adapter "cli" does not support login' });
    });
  });

  test("reports unsupported gateway refresh as an error", async () => {
    const home = await tempDir("gateway-refresh-unsupported");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const result = await createAppCli().run(["gateway", "refresh", "say"], { render: false });

      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.result).toEqual({ message: 'Gateway adapter "cli" does not support refresh' });
    });
  });

  test("inspects persisted gateway targets", async () => {
    const home = await tempDir("gateway-inspect");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const result = await createAppCli().run(["gateway", "inspect", "say"], { render: false });

      expect(result.result).toEqual({
        ok: true,
        target: {
          name: "say",
          type: "cli",
          config: { redacted: true },
          registered: true,
          summary: "echo",
          capabilities: { invoke: true, catalog: false, refresh: false, complete: true, check: false },
          operations: [],
        },
        diagnostics: [],
      });
    });
  });

  test("checks persisted gateway targets", async () => {
    const home = await tempDir("gateway-check");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const result = await createAppCli().run(["gateway", "check"], { render: false });

      expect(result.result).toEqual({
        ok: true,
        scope: "gateway",
        adapters: ["cli", "script", "api", "graphql", "mcp", "grpc"],
        targets: [{ name: "say", type: "cli", ok: true, diagnostics: [] }],
        diagnostics: [],
      });
    });
  });

  test("persists gateway aliases in CLIP_HOME and dispatches them", async () => {
    const home = await tempDir("gateway-alias");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const addAlias = await createAppCli().run(["gateway", "alias", "add", "say", "hi", "hello"], { render: false });
      const listAliases = await createAppCli().run(["gateway", "alias", "list", "say"], { render: false });
      const run = await createAppCli().run(["say", "hi", "example"], { render: false });
      const config = await readFile(join(home, "gateway", "cli", "say", "aliases", "hi.toml"), "utf8");

      expect(addAlias.result).toEqual({ target: "say", name: "hi", operation: "hello" });
      expect(listAliases.result).toEqual({ aliases: [{ target: "say", name: "hi", operation: "hello", args: [] }] });
      expect(run.result).toBe("hello example");
      expect(config).toContain('name = "hi"');
      expect(config).toContain('operation = "hello"');
    });
  });

  test("persists gateway bindings in CLIP_HOME and writes shims", async () => {
    const home = await tempDir("gateway-bind");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const bind = await createAppCli().run(["gateway", "bind", "hi", "say", "hello"], { render: false });
      const list = await createAppCli().run(["gateway", "binds"], { render: false });
      const run = await createAppCli().run(["hi", "example"], { render: false });
      const config = await readFile(join(home, "gateway", "_bindings", "hi.toml"), "utf8");
      const shim = await readFile(join(home, "bin", "hi"), "utf8");

      expect(bind.result).toEqual({ name: "hi", target: "say", args: ["hello"] });
      expect(list.result).toEqual({ bindings: [{ name: "hi", target: "say", args: ["hello"] }] });
      expect(run.result).toBe("hello example");
      expect(config).toContain('name = "hi"');
      expect(config).toContain('target = "say"');
      expect(config).toContain('args = ["hello"]');
      expect(shim).toContain("exec clip 'hi'");
    });
  });

  test("persists gateway profiles in CLIP_HOME and dispatches them", async () => {
    const home = await tempDir("gateway-profile");

    await withClipHome(home, async () => {
      await createAppCli().run(["gateway", "add", "say", "echo", "--type", "cli"], { render: false });

      const addProfile = await createAppCli().run(["gateway", "profile", "add", "say", "dev", "hello"], {
        render: false,
      });
      const useProfile = await createAppCli().run(["gateway", "profile", "use", "say", "dev"], { render: false });
      const listProfiles = await createAppCli().run(["gateway", "profile", "list", "say"], { render: false });
      const run = await createAppCli().run(["say", "example"], { render: false });
      const targetConfig = await readFile(join(home, "gateway", "cli", "say", "config.toml"), "utf8");
      const config = await readFile(join(home, "gateway", "cli", "say", "profiles", "dev.toml"), "utf8");

      expect(addProfile.result).toEqual({ target: "say", name: "dev" });
      expect(useProfile.result).toEqual({ target: "say", name: "dev" });
      expect(listProfiles.result).toEqual({
        profiles: [{ target: "say", name: "dev", config: { args: ["hello"] }, active: true }],
      });
      expect(run.result).toBe("hello example");
      expect(targetConfig).toContain('defaultProfile = "dev"');
      expect(config).toContain('name = "dev"');
      expect(config).toContain("[config]");
      expect(config).toContain('args = ["hello"]');
    });
  });
});

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `clip-cli-${label}-`));
}

async function withClipHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.CLIP_HOME;
  process.env.CLIP_HOME = home;
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "CLIP_HOME");
    } else {
      process.env.CLIP_HOME = previous;
    }
  }
}
