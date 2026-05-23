import type { AddInput, GatewayAdapter, GatewayContext, GatewayInvokeContext, GatewayResult } from "../types";

export type McpAdapterConfig = {
  url: string;
  headers?: Record<string, string>;
  protocolVersion?: string;
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
    async add(input) {
      return mcpConfigFromAddInput(input);
    },
    createTarget({ manifest, config, context }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return executeMcpTarget(config, ctx, context);
        },
        async catalog() {
          return [];
        },
        listRow() {
          return { name: manifest.name, type: "mcp", summary: config.url };
        },
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

  return {
    url: value.url,
    ...(value.headers ? { headers: value.headers } : {}),
    ...(value.protocolVersion ? { protocolVersion: value.protocolVersion } : {}),
  };
}

async function executeMcpTarget(
  config: McpAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
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
  const headers = {
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
    const failed =
      response.status < 200 ||
      response.status >= 400 ||
      response.headers.get("content-type")?.includes("text/event-stream") ||
      hasJsonRpcError(responseValue);

    return failed ? { ok: false, error: value, exitCode: 1 } : { ok: true, value, exitCode: 0 };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  }
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
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
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
