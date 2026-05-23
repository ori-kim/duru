import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryGatewayStore } from "../../memory-store";
import { mcpAdapter } from "./index";

describe("@clip/cli-gateway mcp adapter", () => {
  test("invokes MCP tools through tools/call with JSON object input", async () => {
    const calls: Array<{ input: string; body: unknown }> = [];
    const adapter = mcpAdapter();
    const config = adapter.schema.parse({ url: "https://catservice.example.com/mcp" });
    const target = adapter.createTarget({
      manifest: { name: "catservice", type: "mcp", config },
      config,
      context: {
        store: createMemoryGatewayStore(),
        services: {
          async fetch(input: string | URL | Request, init?: RequestInit) {
            calls.push({ input: String(input), body: init?.body });
            return new Response(
              JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }),
              {
                status: 200,
                statusText: "OK",
                headers: { "content-type": "application/json" },
              },
            );
          },
        },
      },
    });

    const result = await target.invoke({
      argv: ["listCats", '{"limit":2}', "--tag", "test-service"],
    });

    expect(calls).toEqual([
      {
        input: "https://catservice.example.com/mcp",
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "listCats", arguments: { limit: 2, tag: "test-service" } },
        }),
      },
    ]);
    expect(result).toEqual({
      ok: true,
      value: {
        status: 200,
        statusText: "OK",
        body: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } },
      },
      exitCode: 0,
    });
  });

  test("keeps raw JSON-RPC methods behind the raw subcommand", async () => {
    const calls: Array<{ body: unknown }> = [];
    const adapter = mcpAdapter();
    const config = adapter.schema.parse({ url: "https://catservice.example.com/mcp" });
    const target = adapter.createTarget({
      manifest: { name: "catservice", type: "mcp", config },
      config,
      context: {
        store: createMemoryGatewayStore(),
        services: {
          async fetch(_input: string | URL | Request, init?: RequestInit) {
            calls.push({ body: init?.body });
            return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
              status: 200,
              statusText: "OK",
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    });

    const result = await target.invoke({
      argv: ["raw", "initialize", "--params", '{"protocolVersion":"2025-06-18"}'],
    });

    expect(calls).toEqual([
      {
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18" },
        }),
      },
    ]);
    expect(result.ok).toBe(true);
  });

  test("invokes MCP stdio tools through tools/call", async () => {
    const home = await mkdtemp(join(tmpdir(), "clip-mcp-stdio-call-"));
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
        "    } else if (req.method === 'tools/call') {",
        "      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { name: req.params.name, arguments: req.params.arguments } }) + '\\n');",
        "    }",
        "  }",
        "});",
      ].join("\n"),
    );
    const adapter = mcpAdapter();
    const config = adapter.schema.parse({ transport: "stdio", command: "bun", args: [server] });
    const target = adapter.createTarget({
      manifest: { name: "catservice", type: "mcp", config },
      config,
      context: { store: createMemoryGatewayStore() },
    });

    const result = await target.invoke({ argv: ["listCats", '{"limit":2}'] });

    expect(result).toEqual({
      ok: true,
      value: {
        status: 0,
        statusText: "OK",
        body: { jsonrpc: "2.0", id: 1, result: { name: "listCats", arguments: { limit: 2 } } },
      },
      exitCode: 0,
    });
  });
});
