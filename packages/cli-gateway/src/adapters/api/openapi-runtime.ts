import type { GatewayContext, GatewayInvokeContext, GatewayResult } from "../../types";
import type { ApiAdapterConfig } from "./config";
import { fetchSpec, hasHeader, performApiRequest } from "./http";
import { defaultJsonContentType, operationBody } from "./openapi-body";
import type { OperationArgs } from "./openapi-body";
import { parseOpenApi } from "./openapi-parser";
import type { OpenApiTool, ParsedOpenApi } from "./openapi-parser";

export async function loadParsedSpec(
  config: ApiAdapterConfig,
  context: GatewayContext,
  signal?: AbortSignal,
): Promise<ParsedOpenApi | undefined> {
  if (config.spec !== undefined) return parseOpenApi(config.spec);
  if (!config.openapiUrl) return undefined;
  return parseOpenApi(await fetchSpec(config, context, signal));
}

export async function executeOpenApiOperation(
  config: ApiAdapterConfig,
  spec: ParsedOpenApi,
  tool: OpenApiTool,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  let args: OperationArgs;

  try {
    args = parseOperationArgs(ctx.argv.slice(1));
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  let url: string;
  try {
    const baseUrl = config.baseUrl ?? spec.baseUrl;
    if (!baseUrl) throw new Error("API target requires baseUrl or OpenAPI servers for operation requests");
    url = buildOperationUrl(baseUrl, tool, args.params);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const body = operationBody(tool, args);
  const requestHeaders = { ...(config.headers ?? {}), ...args.headers };
  const headers = {
    ...(config.headers ?? {}),
    ...headerParams(tool, args.params),
    ...args.headers,
    ...(body?.contentType && !hasHeader(requestHeaders, "content-type") ? { "content-type": body.contentType } : {}),
    ...(body && !body.contentType && defaultJsonContentType(tool) && !hasHeader(requestHeaders, "content-type")
      ? { "content-type": "application/json" }
      : {}),
  };

  return performApiRequest(
    {
      url,
      method: tool.method,
      headers,
      ...(body ? { body: body.body } : {}),
    },
    ctx,
    gatewayContext,
    { target, ...(profile ? { profile } : {}), config },
  );
}

function parseOperationArgs(argv: readonly string[]): OperationArgs {
  const params: Record<string, unknown> = {};
  const headers: Record<string, string> = {};
  let body: string | undefined;
  let bodyBase64: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--header" || arg === "-H") {
      setHeader(headers, requiredNext(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
      continue;
    }

    if (arg === "--body") {
      body = requiredNext(argv, ++index, "--body");
      continue;
    }

    if (arg.startsWith("--body=")) {
      body = arg.slice("--body=".length);
      continue;
    }

    if (arg === "--body-base64") {
      bodyBase64 = requiredNext(argv, ++index, "--body-base64");
      continue;
    }

    if (arg.startsWith("--body-base64=")) {
      bodyBase64 = arg.slice("--body-base64=".length);
      continue;
    }

    if (arg === "--input") {
      Object.assign(params, parseJsonObject(requiredNext(argv, ++index, "--input"), "--input"));
      continue;
    }

    if (arg.startsWith("--input=")) {
      Object.assign(params, parseJsonObject(arg.slice("--input=".length), "--input"));
      continue;
    }

    if (arg.startsWith("--") && arg.includes("=")) {
      const separator = arg.indexOf("=");
      params[arg.slice(2, separator)] = parseCliValue(arg.slice(separator + 1));
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = argv[index + 1]?.startsWith("--") || argv[index + 1] === undefined ? "true" : argv[++index];
      params[key] = parseCliValue(value ?? "");
      continue;
    }

    if (arg.startsWith("{")) {
      const value = parseCliValue(arg);
      if (isRecord(value)) Object.assign(params, value);
    }
  }

  return { params, headers, ...(body ? { body } : {}), ...(bodyBase64 ? { bodyBase64 } : {}) };
}

function buildOperationUrl(baseUrl: string, tool: OpenApiTool, params: Record<string, unknown>): string {
  const path = tool.path.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const value = params[key];
    if (value === undefined) throw new Error(`Missing required path parameter: ${key}`);
    return encodeURIComponent(paramString(value));
  });
  const url = new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`);

  for (const key of tool.queryParams) {
    const value = params[key];
    if (value === undefined) continue;
    appendSearchParam(url, key, value);
  }

  return url.toString();
}

function appendSearchParam(url: URL, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) url.searchParams.append(key, paramString(item));
    return;
  }
  url.searchParams.append(key, paramString(value));
}

function headerParams(tool: OpenApiTool, params: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const key of tool.headerParams) {
    const value = params[key];
    if (value !== undefined) headers[key] = paramString(value);
  }
  return headers;
}

function setHeader(headers: Record<string, string>, value: string): void {
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid header: ${value}`);
  headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
}

function requiredNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
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

function parseJsonObject(value: string, option: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error(`${option} must be a JSON object`);
  return parsed;
}

function paramString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
