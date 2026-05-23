import { oauthAuthorizationHeader } from "../../auth";
import type { GatewayContext, GatewayInvokeContext, GatewayResult } from "../../types";
import type { McpSseAdapterConfig } from "./config";
import {
  type McpRequestArgs,
  errorMessage,
  fetcher,
  hasHeader,
  hasJsonRpcError,
  mcpRequestBody,
  mcpRequestPayload,
  parseMcpArgs,
  responseBody,
} from "./request";

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

type PendingResponse = {
  resolve(response: JsonRpcResponse): void;
  reject(error: Error): void;
};

export async function executeMcpSseRequest(
  config: McpSseAdapterConfig,
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

  const headers = await sseHeaders(config, ctx, gatewayContext, target, profile, request.headers);
  if (ctx.dryRun) {
    return { ok: true, value: { request: { url: config.url, headers, rpcMethod: request.method } }, exitCode: 0 };
  }

  const session = await openSseSession(config, ctx, gatewayContext, headers);
  try {
    const body = await session.call(mcpRequestPayload(request));
    const value = { status: 202, statusText: "Accepted", body };
    return hasJsonRpcError(body) ? { ok: false, error: value, exitCode: 1 } : { ok: true, value, exitCode: 0 };
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 1 };
  } finally {
    await session.close();
  }
}

async function sseHeaders(
  config: McpSseAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  target: string,
  profile: string | undefined,
  requestHeaders: Record<string, string>,
): Promise<Record<string, string>> {
  const headers = {
    ...(config.headers ?? {}),
    ...requestHeaders,
    ...(!hasHeader({ ...(config.headers ?? {}), ...requestHeaders }, "accept") ? { accept: "text/event-stream" } : {}),
    ...(config.protocolVersion && !hasHeader({ ...(config.headers ?? {}), ...requestHeaders }, "MCP-Protocol-Version")
      ? { "MCP-Protocol-Version": config.protocolVersion }
      : {}),
  };
  return {
    ...headers,
    ...(await oauthAuthorizationHeader({
      context: gatewayContext,
      target,
      profile,
      auth: config.auth,
      headers,
      signal: ctx.signal,
      dryRun: ctx.dryRun,
    })),
  };
}

async function openSseSession(
  config: McpSseAdapterConfig,
  ctx: GatewayInvokeContext,
  gatewayContext: GatewayContext,
  headers: Record<string, string>,
) {
  const pending = new Map<string | number | null, PendingResponse>();
  let endpointResolve!: (value: string) => void;
  let endpointReject!: (error: Error) => void;
  const endpoint = new Promise<string>((resolve, reject) => {
    endpointResolve = resolve;
    endpointReject = reject;
  });

  const response = await fetcher(gatewayContext)(config.url, {
    method: "GET",
    signal: ctx.signal,
    headers,
  });
  if (!response.ok || !response.body) {
    throw new Error(`SSE endpoint returned HTTP ${response.status}`);
  }

  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const read = readSse(reader, {
    endpoint(data) {
      endpointResolve(new URL(data, config.url).toString());
    },
    message(data) {
      const parsed = parseJson(data);
      const id = parsed?.id;
      if (id === undefined) return;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (parsed) entry.resolve(parsed);
    },
    close(error) {
      endpointReject(error);
      for (const entry of pending.values()) entry.reject(error);
      pending.clear();
    },
  });
  const endpointUrl = await endpoint;

  return {
    async call(payload: { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown }) {
      const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
        pending.set(payload.id, { resolve, reject });
      });
      const post = await fetcher(gatewayContext)(endpointUrl, {
        method: "POST",
        signal: ctx.signal,
        headers: {
          ...headers,
          ...(!hasHeader(headers, "content-type") ? { "content-type": "application/json" } : {}),
        },
        body: mcpRequestBody({ method: payload.method, params: payload.params, id: payload.id, headers: {} }),
      });
      const immediate = await responseBody(post);
      if (hasImmediateResponse(immediate)) {
        pending.delete(payload.id);
        return immediate;
      }
      if (!post.ok && post.status !== 202) throw new Error(`SSE message endpoint returned HTTP ${post.status}`);
      return responsePromise;
    },
    async close() {
      await reader.cancel().catch(() => undefined);
      await read.catch(() => undefined);
    },
  };
}

async function readSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  events: { endpoint(data: string): void; message(data: string): void; close(error: Error): void },
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n|\r/g, "\n");
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) dispatchSseBlock(block, events);
    }
  } catch (error) {
    events.close(error instanceof Error ? error : new Error(String(error)));
  }
}

function dispatchSseBlock(block: string, events: { endpoint(data: string): void; message(data: string): void }): void {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
  }
  if (event === "endpoint") events.endpoint(data.join("\n"));
  if (event === "message") events.message(data.join("\n"));
}

function parseJson(value: string): JsonRpcResponse | undefined {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as JsonRpcResponse) : undefined;
  } catch {
    return undefined;
  }
}

function hasImmediateResponse(value: unknown): value is JsonRpcResponse {
  return typeof value === "object" && value !== null && ("result" in value || "error" in value);
}
