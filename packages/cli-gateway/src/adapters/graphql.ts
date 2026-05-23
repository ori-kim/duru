import { createGatewayTargetAuth, oauthAuthorizationHeader, parseOptionalOAuthProviderConfig } from "../auth";
import type { GatewayOAuthProviderConfig } from "../auth";
import type { AddInput, GatewayAdapter, GatewayContext, GatewayInvokeContext, GatewayResult } from "../types";

export type GraphqlAdapterConfig = {
  endpoint: string;
  headers?: Record<string, string>;
  auth?: GatewayOAuthProviderConfig;
};

type GraphqlRequestArgs = {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
  headers: Record<string, string>;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function graphqlAdapter(): GatewayAdapter<GraphqlAdapterConfig> {
  return {
    type: "graphql",
    schema: { parse: parseGraphqlConfig },
    detect(input) {
      const value = input.argv[0];
      return Boolean(value && isAbsoluteHttpUrl(value) && /graphql/i.test(new URL(value).pathname));
    },
    async add(input) {
      return graphqlConfigFromAddInput(input);
    },
    createTarget({ manifest, config, context, profile }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        profile: profile?.name,
        async invoke(ctx) {
          return executeGraphqlTarget(config, ctx, context, manifest.name, profile?.name);
        },
        async catalog() {
          return [];
        },
        listRow() {
          return { name: manifest.name, type: "graphql", summary: config.endpoint };
        },
        auth: createGatewayTargetAuth({ manifest, auth: config.auth, context }),
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function graphqlConfigFromAddInput(input: AddInput): GraphqlAdapterConfig {
  const endpoint = input.argv[0];
  if (!endpoint) throw new Error("GraphQL target requires an endpoint argument");
  return { endpoint };
}

function parseGraphqlConfig(value: unknown): GraphqlAdapterConfig {
  if (!isRecord(value) || typeof value.endpoint !== "string" || value.endpoint.length === 0) {
    throw new Error("Invalid graphql target config: endpoint is required");
  }

  if (!isAbsoluteHttpUrl(value.endpoint)) {
    throw new Error("Invalid graphql target config: endpoint must be an absolute URL");
  }

  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid graphql target config: headers must be a string record");
  }

  const auth = value.auth ? parseOptionalOAuthProviderConfig(value.auth) : undefined;
  return {
    endpoint: value.endpoint,
    ...(value.headers ? { headers: value.headers } : {}),
    ...(auth ? { auth } : {}),
  };
}

async function executeGraphqlTarget(
  config: GraphqlAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  let request: GraphqlRequestArgs;
  try {
    request = parseGraphqlArgs(ctx.argv);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const body = JSON.stringify({
    query: request.query,
    ...(request.variables ? { variables: request.variables } : {}),
    ...(request.operationName ? { operationName: request.operationName } : {}),
  });
  const baseHeaders = {
    ...(config.headers ?? {}),
    ...request.headers,
    ...(!hasHeader({ ...(config.headers ?? {}), ...request.headers }, "content-type")
      ? { "content-type": "application/json" }
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
    return { ok: true, value: { request: { url: config.endpoint, ...init } }, exitCode: 0 };
  }

  try {
    const response = await fetcher(gatewayContext)(config.endpoint, init);
    const responseValue = await responseBody(response);
    const value = { status: response.status, statusText: response.statusText, body: responseValue };
    const failed = response.status < 200 || response.status >= 400 || hasGraphqlErrors(responseValue);

    return failed ? { ok: false, error: value, exitCode: 1 } : { ok: true, value, exitCode: 0 };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  }
}

function parseGraphqlArgs(argv: readonly string[]): GraphqlRequestArgs {
  let query: string | undefined;
  let variables: Record<string, unknown> | undefined;
  let operationName: string | undefined;
  const headers: Record<string, string> = {};
  const queryParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--query") {
      query = requiredNext(argv, ++index, "--query");
      continue;
    }

    if (arg.startsWith("--query=")) {
      query = arg.slice("--query=".length);
      continue;
    }

    if (arg === "--variables") {
      variables = parseJsonObject(requiredNext(argv, ++index, "--variables"), "--variables");
      continue;
    }

    if (arg.startsWith("--variables=")) {
      variables = parseJsonObject(arg.slice("--variables=".length), "--variables");
      continue;
    }

    if (arg === "--operation-name") {
      operationName = requiredNext(argv, ++index, "--operation-name");
      continue;
    }

    if (arg.startsWith("--operation-name=")) {
      operationName = arg.slice("--operation-name=".length);
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

    queryParts.push(arg);
  }

  const finalQuery = query ?? queryParts.join(" ").trim();
  if (!finalQuery) throw new Error("GraphQL query is required");

  return {
    query: finalQuery,
    ...(variables ? { variables } : {}),
    ...(operationName ? { operationName } : {}),
    headers,
  };
}

function requiredNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function parseJsonObject(value: string, option: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error(`${option} must be a JSON object`);
  return parsed;
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

function hasGraphqlErrors(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.errors) && value.errors.length > 0;
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
