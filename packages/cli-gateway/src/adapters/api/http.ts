import { oauthAuthorizationHeader } from "../../auth";
import type { GatewayContext, GatewayInvokeContext, GatewayResult } from "../../types";
import type { ApiAdapterConfig } from "./config";
import { buildUrl, isRawRequestStart, parseRequestArgs } from "./raw-request";
import { responseBody } from "./response";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type RequestBody = NonNullable<RequestInit["body"]>;

export async function executeRawApiTarget(
  config: ApiAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
): Promise<GatewayResult> {
  let request: ReturnType<typeof parseRequestArgs>;

  try {
    request = parseRequestArgs(ctx.argv);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  let url: string;
  try {
    if (!config.baseUrl) throw new Error("API target requires baseUrl for raw HTTP requests");
    url = buildUrl(config.baseUrl, request.path, request.query);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const baseHeaders = {
    ...(config.headers ?? {}),
    ...request.headers,
    ...(request.contentType && !hasHeader({ ...(config.headers ?? {}), ...request.headers }, "content-type")
      ? { "content-type": request.contentType }
      : {}),
    ...(request.body &&
    !request.contentType &&
    defaultJsonBody(request.body) &&
    !hasHeader({ ...(config.headers ?? {}), ...request.headers }, "content-type")
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

  return performApiRequest(
    {
      url,
      method: request.method,
      headers,
      ...(request.body ? { body: request.body } : {}),
    },
    ctx,
    gatewayContext,
  );
}

export async function performApiRequest(
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: RequestBody;
  },
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  auth?: { target: string; profile?: string; config: ApiAdapterConfig },
): Promise<GatewayResult> {
  const headers = {
    ...request.headers,
    ...(auth
      ? await oauthAuthorizationHeader({
          context: gatewayContext,
          target: auth.target,
          profile: auth.profile,
          auth: auth.config.auth,
          headers: request.headers,
          signal: ctx.signal,
          dryRun: ctx.dryRun,
        })
      : {}),
  };
  const init: RequestInit = {
    method: request.method,
    signal: ctx.signal,
    ...(Object.keys(headers).length > 0 ? { headers } : {}),
    ...(request.body ? { body: request.body } : {}),
  };

  if (ctx.dryRun) {
    return { ok: true, value: { request: { url: request.url, ...init } }, exitCode: 0 };
  }

  try {
    const response = await fetcher(gatewayContext)(request.url, init);
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

export async function fetchSpec(
  config: Pick<ApiAdapterConfig, "headers" | "openapiUrl">,
  context: GatewayContext,
  signal?: AbortSignal,
): Promise<unknown> {
  if (!config.openapiUrl) throw new Error("API target requires openapiUrl to refresh an OpenAPI spec");

  const response = await fetcher(context)(config.openapiUrl, {
    method: "GET",
    signal,
    ...(config.headers ? { headers: config.headers } : {}),
  });
  const body = await responseBody(response);

  if (response.status < 200 || response.status >= 400) {
    throw new Error(`OpenAPI spec request failed with status ${response.status}`);
  }

  if (typeof body !== "string") return body;

  try {
    return JSON.parse(body);
  } catch {
    throw new Error("OpenAPI spec response must be JSON");
  }
}

export { isRawRequestStart };

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase());
}

function fetcher(context: GatewayContext): FetchLike {
  const candidate = context.services?.fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : fetch;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultJsonBody(body: RequestBody): boolean {
  return typeof body === "string";
}
