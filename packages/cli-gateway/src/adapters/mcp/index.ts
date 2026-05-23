import { createGatewayTargetAuth } from "../../auth";
import type { GatewayContext, GatewayInvokeContext, GatewayResult, GatewayTool } from "../../types";
import type { GatewayAdapter } from "../../types";
import { type McpAdapterConfig, detectMcpInput, mcpConfigFromAddInput, mcpSummary, parseMcpConfig } from "./config";
import { executeMcpHttpRequest } from "./http";
import { executeMcpSseRequest } from "./sse";
import { executeMcpStdioRequest } from "./stdio";
import { mcpHelpOperations, mcpToolsFromResponse } from "./tools";

export type { McpAdapterConfig } from "./config";

export function mcpAdapter(): GatewayAdapter<McpAdapterConfig> {
  return {
    type: "mcp",
    schema: { parse: parseMcpConfig },
    detect(input) {
      return detectMcpInput(input);
    },
    async add(input) {
      return mcpConfigFromAddInput(input);
    },
    createTarget({ manifest, config, context, profile }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        profile: profile?.name,
        async invoke(ctx) {
          return executeMcpTarget(config, ctx, context, manifest.name, profile?.name);
        },
        async catalog(ctx) {
          const result = await executeMcpToolsList(
            config,
            { argv: ["tools/list"], ...(ctx.signal ? { signal: ctx.signal } : {}) },
            context,
            manifest.name,
            profile?.name,
          );
          return result.ok && Array.isArray(result.value) ? result.value : [];
        },
        listRow() {
          return { name: manifest.name, type: "mcp", summary: mcpSummary(config) };
        },
        auth:
          config.transport === "stdio" ? undefined : createGatewayTargetAuth({ manifest, auth: config.auth, context }),
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

async function executeMcpTarget(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  const firstArg = ctx.argv[0];
  if (!firstArg || firstArg === "tools") {
    return executeMcpToolsList(config, ctx, gatewayContext, target, profile);
  }
  if (firstArg === "--help" || firstArg === "-h") {
    return executeMcpHelp(config, ctx, gatewayContext, target, profile);
  }
  if (firstArg === "describe") {
    const toolName = ctx.argv[1];
    if (!toolName) return { ok: false, error: { message: "describe requires a tool name" }, exitCode: 2 };

    const tools = await executeMcpToolsList(config, ctx, gatewayContext, target, profile);
    if (!tools.ok) return tools;

    const tool = Array.isArray(tools.value) ? tools.value.find((item) => item.name === toolName) : undefined;
    if (!tool) return { ok: false, error: { message: `Unknown MCP tool: "${toolName}"` }, exitCode: 2 };

    return { ok: true, value: tool, exitCode: 0 };
  }
  if (firstArg === "types") return { ok: true, value: [], exitCode: 0 };
  if (firstArg === "raw") {
    return executeMcpRequest(config, { ...ctx, argv: ctx.argv.slice(1) }, gatewayContext, target, profile);
  }
  if (firstArg.includes("/")) return executeMcpRequest(config, ctx, gatewayContext, target, profile);

  return executeMcpToolCall(config, ctx, gatewayContext, target, profile);
}

async function executeMcpHelp(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  const tools = await executeMcpToolsList(config, ctx, gatewayContext, target, profile);
  if (!tools.ok) return tools;

  const operations = Array.isArray(tools.value) ? tools.value : [];
  return {
    ok: true,
    value: {
      target,
      type: "mcp",
      usage: `${target} <tool|method>`,
      operations: [...mcpHelpOperations(), ...operations],
    },
    exitCode: 0,
  };
}

async function executeMcpToolsList(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  const result = await executeMcpRequest(config, { ...ctx, argv: ["tools/list"] }, gatewayContext, target, profile);
  if (!result.ok) return result;
  if (ctx.dryRun) return result;

  const tools = mcpToolsFromResponse(result.value);
  if (!tools) return { ok: false, error: { message: "MCP tools/list response is invalid" }, exitCode: 1 };

  return { ok: true, value: tools, exitCode: 0 };
}

function executeMcpRequest(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  if (config.transport === "stdio") return executeMcpStdioRequest(config, ctx);
  if (config.transport === "sse") return executeMcpSseRequest(config, ctx, gatewayContext, target, profile);
  return executeMcpHttpRequest(config, ctx, gatewayContext, target, profile);
}

function executeMcpToolCall(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  const toolName = ctx.argv[0];
  if (!toolName) return executeMcpToolsList(config, ctx, gatewayContext, target, profile);

  let input: { arguments: Record<string, unknown>; headers: readonly string[] };
  try {
    input = parseMcpToolInput(ctx.argv.slice(1));
  } catch (error) {
    return Promise.resolve({ ok: false, error: { message: errorMessage(error) }, exitCode: 2 });
  }

  const params = {
    name: toolName,
    ...(Object.keys(input.arguments).length > 0 ? { arguments: input.arguments } : {}),
  };
  const argv = [
    "tools/call",
    "--params",
    JSON.stringify(params),
    ...input.headers.flatMap((header) => ["--header", header]),
  ];

  return executeMcpRequest(config, { ...ctx, argv }, gatewayContext, target, profile);
}

function parseMcpToolInput(argv: readonly string[]): {
  arguments: Record<string, unknown>;
  headers: readonly string[];
} {
  const args: Record<string, unknown> = {};
  const headers: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--header" || arg === "-H") {
      headers.push(requiredNext(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--header=")) {
      headers.push(arg.slice("--header=".length));
      continue;
    }

    if (arg === "--input" || arg === "--arguments" || arg === "--params") {
      Object.assign(args, parseJsonObject(requiredNext(argv, ++index, arg), arg));
      continue;
    }

    if (arg.startsWith("--input=")) {
      Object.assign(args, parseJsonObject(arg.slice("--input=".length), "--input"));
      continue;
    }

    if (arg.startsWith("--arguments=")) {
      Object.assign(args, parseJsonObject(arg.slice("--arguments=".length), "--arguments"));
      continue;
    }

    if (arg.startsWith("--params=")) {
      Object.assign(args, parseJsonObject(arg.slice("--params=".length), "--params"));
      continue;
    }

    if (arg.startsWith("--") && arg.includes("=")) {
      const separator = arg.indexOf("=");
      args[arg.slice(2, separator)] = parseCliValue(arg.slice(separator + 1));
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? "true" : argv[++index];
      args[key] = parseCliValue(value ?? "");
      continue;
    }

    if (arg.startsWith("{")) {
      Object.assign(args, parseJsonObject(arg, "input"));
    }
  }

  return { arguments: args, headers };
}

function parseJsonObject(value: string, option: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error(`${option} must be a JSON object`);
  return parsed;
}

function parseCliValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("{") || value.startsWith("[")) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function requiredNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
