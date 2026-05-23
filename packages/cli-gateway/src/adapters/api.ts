import type { AddInput, GatewayAdapter, GatewayContext, GatewayInvokeContext, GatewayResult } from "../types";

export type ApiAdapterConfig = {
  baseUrl: string;
  headers?: Record<string, string>;
};

type RequestArgs = {
  method: string;
  path: string;
  query: Record<string, string | readonly string[]>;
  headers: Record<string, string>;
  body?: string;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function apiAdapter(): GatewayAdapter<ApiAdapterConfig> {
  return {
    type: "api",
    schema: { parse: parseApiConfig },
    detect(input) {
      const value = input.argv[0];
      return Boolean(value && isAbsoluteHttpUrl(value) && !looksLikeGraphqlUrl(value) && !looksLikeMcpUrl(value));
    },
    async add(input) {
      return apiConfigFromAddInput(input);
    },
    createTarget({ manifest, config, context }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return executeApiTarget(config, ctx, context);
        },
        async catalog() {
          return [];
        },
        listRow() {
          return { name: manifest.name, type: "api", summary: config.baseUrl };
        },
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function apiConfigFromAddInput(input: AddInput): ApiAdapterConfig {
  const baseUrl = input.argv[0];
  if (!baseUrl) throw new Error("API target requires a baseUrl argument");
  return { baseUrl };
}

function parseApiConfig(value: unknown): ApiAdapterConfig {
  if (!isRecord(value)) throw new Error("Invalid api target config: baseUrl is required");

  const baseUrl = stringValue(value.baseUrl) ?? stringValue(value.url);
  if (!baseUrl) throw new Error("Invalid api target config: baseUrl is required");
  if (!isAbsoluteHttpUrl(baseUrl)) throw new Error("Invalid api target config: baseUrl must be an absolute URL");

  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid api target config: headers must be a string record");
  }

  return {
    baseUrl,
    ...(value.headers ? { headers: value.headers } : {}),
  };
}

async function executeApiTarget(
  config: ApiAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
): Promise<GatewayResult> {
  let request: RequestArgs;

  try {
    request = parseRequestArgs(ctx.argv);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  let url: string;
  try {
    url = buildUrl(config.baseUrl, request.path, request.query);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const headers = {
    ...(config.headers ?? {}),
    ...request.headers,
    ...(request.body && !hasHeader({ ...(config.headers ?? {}), ...request.headers }, "content-type")
      ? { "content-type": "application/json" }
      : {}),
  };
  const init: RequestInit = {
    method: request.method,
    signal: ctx.signal,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(request.body ? { body: request.body } : {}),
  };

  if (ctx.dryRun) {
    return { ok: true, value: { request: { url, ...init } }, exitCode: 0 };
  }

  try {
    const response = await fetcher(gatewayContext)(url, init);
    const body = await responseBody(response);
    const value = {
      status: response.status,
      statusText: response.statusText,
      body,
    };

    if (response.status >= 200 && response.status < 400) {
      return { ok: true, value, exitCode: 0 };
    }

    return {
      ok: false,
      error: value,
      exitCode: 1,
    };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  }
}

function parseRequestArgs(argv: readonly string[]): RequestArgs {
  const [first, second, ...rest] = argv;
  const firstMethod = first?.toUpperCase();
  const method = firstMethod && httpMethods.has(firstMethod) ? firstMethod : "GET";
  const path = method === "GET" && firstMethod !== "GET" ? (first ?? "/") : (second ?? "/");
  const args = method === "GET" && firstMethod !== "GET" ? argv.slice(1) : rest;
  const query: Record<string, string | readonly string[]> = {};
  const headers: Record<string, string> = {};
  let body: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--header" || arg === "-H") {
      const header = args[++index];
      if (!header) throw new Error(`${arg} requires <name:value>`);
      setHeader(headers, header);
      continue;
    }

    if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
      continue;
    }

    if (arg === "--body") {
      const value = args[++index];
      if (value === undefined) throw new Error("--body requires a value");
      body = value;
      continue;
    }

    if (arg.startsWith("--body=")) {
      body = arg.slice("--body=".length);
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[index + 1]?.startsWith("--") || args[index + 1] === undefined ? "true" : args[++index];
      appendQuery(query, key, value ?? "");
    }
  }

  return { method, path, query, headers, ...(body ? { body } : {}) };
}

function setHeader(headers: Record<string, string>, value: string): void {
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid header: ${value}`);
  headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
}

function appendQuery(query: Record<string, string | readonly string[]>, key: string, value: string): void {
  const current = query[key];
  if (current === undefined) {
    query[key] = value;
    return;
  }
  query[key] = Array.isArray(current) ? [...current, value] : [current, value];
}

function buildUrl(baseUrl: string, path: string, query: RequestArgs["query"]): string {
  if (isAbsoluteHttpUrl(path)) throw new Error("Absolute api operation paths are not allowed");

  const url = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) url.searchParams.append(key, item);
  }
  return url.toString();
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

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function looksLikeGraphqlUrl(value: string): boolean {
  return /graphql/i.test(new URL(value).pathname);
}

function looksLikeMcpUrl(value: string): boolean {
  return /mcp/i.test(new URL(value).pathname);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
