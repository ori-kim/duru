import type { GatewayContext } from "../../types";

export type McpRequestArgs = {
  method: string;
  params?: unknown;
  id?: string | number | null;
  headers: Record<string, string>;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function parseMcpArgs(argv: readonly string[]): McpRequestArgs {
  let method: string | undefined;
  let params: unknown;
  let id: string | number | null | undefined;
  const headers: Record<string, string> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--method") {
      method = requiredNext(argv, ++index, "--method");
    } else if (arg.startsWith("--method=")) {
      method = arg.slice("--method=".length);
    } else if (arg === "--params") {
      params = JSON.parse(requiredNext(argv, ++index, "--params"));
    } else if (arg.startsWith("--params=")) {
      params = JSON.parse(arg.slice("--params=".length));
    } else if (arg === "--id") {
      id = parseJsonRpcId(requiredNext(argv, ++index, "--id"));
    } else if (arg.startsWith("--id=")) {
      id = parseJsonRpcId(arg.slice("--id=".length));
    } else if (arg === "--header" || arg === "-H") {
      setHeader(headers, requiredNext(argv, ++index, arg));
    } else if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
    } else if (!arg.startsWith("--") && !method) {
      method = arg;
    }
  }

  if (!method) throw new Error("MCP method is required");
  return {
    method,
    ...(params !== undefined ? { params } : {}),
    ...(id !== undefined ? { id } : {}),
    headers,
  };
}

export function mcpRequestPayload(request: McpRequestArgs): {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
} {
  return {
    jsonrpc: "2.0",
    id: request.id ?? 1,
    method: request.method,
    ...("params" in request ? { params: request.params } : {}),
  };
}

export function mcpRequestBody(request: McpRequestArgs): string {
  return JSON.stringify(mcpRequestPayload(request));
}

export function fetcher(context: GatewayContext): FetchLike {
  const candidate = context.services?.fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : fetch;
}

export async function responseBody(response: Response): Promise<unknown> {
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

export function parseEventStreamBody(text: string): unknown | undefined {
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

export function hasJsonRpcError(value: unknown): boolean {
  return isRecord(value) && value.error !== undefined;
}

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
