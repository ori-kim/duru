import { oauthAuthorizationHeader } from "../../auth";
import type { GatewayContext, GatewayInvokeContext, GatewayResult } from "../../types";
import type { McpHttpAdapterConfig } from "./config";
import {
  type McpRequestArgs,
  errorMessage,
  fetcher,
  hasHeader,
  hasJsonRpcError,
  mcpRequestBody,
  parseMcpArgs,
  responseBody,
} from "./request";

export async function executeMcpHttpRequest(
  config: McpHttpAdapterConfig,
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

  const requestHeaders = { ...(config.headers ?? {}), ...request.headers };
  const baseHeaders = {
    ...requestHeaders,
    ...(!hasHeader(requestHeaders, "content-type") ? { "content-type": "application/json" } : {}),
    ...(!hasHeader(requestHeaders, "accept") ? { accept: "application/json, text/event-stream" } : {}),
    ...(config.protocolVersion && !hasHeader(requestHeaders, "MCP-Protocol-Version")
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
    body: mcpRequestBody(request),
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
