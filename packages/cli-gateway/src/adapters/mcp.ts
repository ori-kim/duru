import { createGatewayTargetAuth, oauthAuthorizationHeader, parseOptionalOAuthProviderConfig } from "../auth";
import type { GatewayOAuthProviderConfig } from "../auth";
import type {
  AddInput,
  GatewayAdapter,
  GatewayContext,
  GatewayInvokeContext,
  GatewayResult,
  GatewayTool,
} from "../types";

export type McpAdapterConfig = {
  url: string;
  headers?: Record<string, string>;
  protocolVersion?: string;
  auth?: GatewayOAuthProviderConfig;
};

type McpRequestArgs = {
  method: string;
  params?: unknown;
  id?: string | number | null;
  headers: Record<string, string>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function mcpAdapter(): GatewayAdapter<McpAdapterConfig> {
  return {
    type: "mcp",
    schema: { parse: parseMcpConfig },
    detect(input) {
      const value = input.argv[0];
      return Boolean(value && isAbsoluteHttpUrl(value) && /mcp/i.test(new URL(value).pathname));
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
          return { name: manifest.name, type: "mcp", summary: config.url };
        },
        auth: createGatewayTargetAuth({ manifest, auth: config.auth, context }),
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function mcpConfigFromAddInput(input: AddInput): McpAdapterConfig {
  const url = input.argv[0];
  if (!url) throw new Error("MCP target requires a url argument");
  return { url };
}

function parseMcpConfig(value: unknown): McpAdapterConfig {
  if (!isRecord(value) || typeof value.url !== "string" || value.url.length === 0) {
    throw new Error("Invalid mcp target config: url is required");
  }

  if (!isAbsoluteHttpUrl(value.url)) {
    throw new Error("Invalid mcp target config: url must be an absolute URL");
  }

  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid mcp target config: headers must be a string record");
  }

  if (value.protocolVersion !== undefined && typeof value.protocolVersion !== "string") {
    throw new Error("Invalid mcp target config: protocolVersion must be a string");
  }

  const auth = value.auth ? parseOptionalOAuthProviderConfig(value.auth) : undefined;
  return {
    url: value.url,
    ...(value.headers ? { headers: value.headers } : {}),
    ...(value.protocolVersion ? { protocolVersion: value.protocolVersion } : {}),
    ...(auth ? { auth } : {}),
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

  return executeMcpRequest(config, ctx, gatewayContext, target, profile);
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

async function executeMcpRequest(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  let request: McpRequestArgs;
  try {
    request = parseMcpArgs(ctx.argv);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: request.id ?? 1,
    method: request.method,
    ...("params" in request ? { params: request.params } : {}),
  });
  const baseHeaders = {
    ...(config.headers ?? {}),
    ...request.headers,
    ...(!hasHeader({ ...(config.headers ?? {}), ...request.headers }, "content-type")
      ? { "content-type": "application/json" }
      : {}),
    ...(!hasHeader({ ...(config.headers ?? {}), ...request.headers }, "accept")
      ? { accept: "application/json, text/event-stream" }
      : {}),
    ...(config.protocolVersion && !hasHeader({ ...(config.headers ?? {}), ...request.headers }, "MCP-Protocol-Version")
      ? { "MCP-Protocol-Version": config.protocolVersion }
      : {}),
  };
  const headers = {
    ...baseHeaders,
    ...(await oauthAuthorizationHeader({
      context: gatewayContext,
      target,
      profile,
      auth: config.auth,
      headers: baseHeaders,
      signal: ctx.signal,
      dryRun: ctx.dryRun,
    })),
  };
  const init: RequestInit = {
    method: "POST",
    signal: ctx.signal,
    headers,
    body,
  };

  if (ctx.dryRun) {
    return { ok: true, value: { request: { url: config.url, ...init, rpcMethod: request.method } }, exitCode: 0 };
  }

  try {
    const response = await fetcher(gatewayContext)(config.url, init);
    const responseValue = await responseBody(response);
    const value = { status: response.status, statusText: response.statusText, body: responseValue };
    const failed = response.status < 200 || response.status >= 400 || hasJsonRpcError(responseValue);

    return failed ? { ok: false, error: value, exitCode: 1 } : { ok: true, value, exitCode: 0 };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  }
}

function mcpHelpOperations(): readonly GatewayTool[] {
  return [
    { name: "tools", description: "List available MCP tools" },
    { name: "describe <tool>", description: "Describe an MCP tool" },
    { name: "types", description: "List available MCP types" },
  ];
}

function mcpToolsFromResponse(value: unknown): readonly GatewayTool[] | undefined {
  if (!isRecord(value) || !isRecord(value.body) || !isRecord(value.body.result)) return undefined;
  const tools = value.body.result.tools;
  if (!Array.isArray(tools)) return [];

  return tools.flatMap((tool) => {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0) return [];
    return [
      {
        name: tool.name,
        ...(typeof tool.description === "string" ? { description: tool.description } : {}),
        ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : {}),
      },
    ];
  });
}

function parseMcpArgs(argv: readonly string[]): McpRequestArgs {
  let method: string | undefined;
  let params: unknown;
  let id: string | number | null | undefined;
  const headers: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--method") {
      method = requiredNext(argv, ++index, "--method");
      continue;
    }

    if (arg.startsWith("--method=")) {
      method = arg.slice("--method=".length);
      continue;
    }

    if (arg === "--params") {
      params = JSON.parse(requiredNext(argv, ++index, "--params"));
      continue;
    }

    if (arg.startsWith("--params=")) {
      params = JSON.parse(arg.slice("--params=".length));
      continue;
    }

    if (arg === "--id") {
      id = parseJsonRpcId(requiredNext(argv, ++index, "--id"));
      continue;
    }

    if (arg.startsWith("--id=")) {
      id = parseJsonRpcId(arg.slice("--id=".length));
      continue;
    }

    if (arg === "--header" || arg === "-H") {
      setHeader(headers, requiredNext(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
      continue;
    }

    if (!arg.startsWith("--") && !method) method = arg;
  }

  if (!method) throw new Error("MCP method is required");
  return {
    method,
    ...(params !== undefined ? { params } : {}),
    ...(id !== undefined ? { id } : {}),
    headers,
  };
}

function requiredNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function parseJsonRpcId(value: string): string | number | null {
  if (value === "null") return null;
  const number = Number(value);
  return Number.isFinite(number) && String(number) === value ? number : value;
}

function setHeader(headers: Record<string, string>, value: string): void {
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid header: ${value}`);
  headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
}

function fetcher(context: GatewayContext): FetchLike {
  const candidate = context.services?.fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : fetch;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return "";
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  if (contentType.includes("text/event-stream")) return parseEventStreamBody(text) ?? text;
  return text;
}

function parseEventStreamBody(text: string): unknown | undefined {
  let lastData: string | undefined;

  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart());
    if (data.length > 0) lastData = data.join("\n");
  }

  if (lastData === undefined) return undefined;
  try {
    return JSON.parse(lastData);
  } catch {
    return lastData;
  }
}

function hasJsonRpcError(value: unknown): boolean {
  return isRecord(value) && value.error !== undefined;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
