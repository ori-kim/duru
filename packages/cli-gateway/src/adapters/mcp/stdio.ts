import type { GatewayInvokeContext, GatewayResult } from "../../types";
import type { McpStdioAdapterConfig } from "./config";
import {
  type McpRequestArgs,
  errorMessage,
  hasJsonRpcError,
  mcpRequestBody,
  mcpRequestPayload,
  parseMcpArgs,
} from "./request";

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

export async function executeMcpStdioRequest(
  config: McpStdioAdapterConfig,
  ctx: GatewayInvokeContext,
): Promise<GatewayResult> {
  let request: McpRequestArgs;
  try {
    request = parseMcpArgs(ctx.argv);
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 2 };
  }

  const command = [config.command, ...(config.args ?? [])];
  if (ctx.dryRun) {
    return {
      ok: true,
      value: { request: { command, rpcMethod: request.method, body: mcpRequestBody(request) } },
      exitCode: 0,
    };
  }

  let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    child = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal,
      env: { ...Bun.env, ...(config.env ?? {}) },
    });
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 127 };
  }

  const lines = readLines(child.stdout);
  try {
    if (request.method !== "initialize") {
      await initialize(child, lines, config.protocolVersion);
    }
    const body = await send(child, lines, mcpRequestPayload(request));
    const value = { status: 0, statusText: "OK", body };
    return hasJsonRpcError(body) ? { ok: false, error: value, exitCode: 1 } : { ok: true, value, exitCode: 0 };
  } catch (error) {
    const stderr = await readableText(child.stderr).catch(() => "");
    return { ok: false, error: { message: errorMessage(error), stderr: stripFinalNewline(stderr) }, exitCode: 1 };
  } finally {
    await closeChild(child);
  }
}

async function initialize(
  child: Bun.Subprocess<"pipe", "pipe", "pipe">,
  lines: AsyncGenerator<string>,
  protocolVersion = "2025-03-26",
): Promise<void> {
  const response = await send(child, lines, {
    jsonrpc: "2.0",
    id: 0,
    method: "initialize",
    params: {
      protocolVersion,
      capabilities: {},
      clientInfo: { name: "duru", version: "0.1.0" },
    },
  });
  if (response.error) throw new Error(`MCP initialize error: ${jsonErrorMessage(response.error)}`);
  await writeLine(child, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
}

async function send(
  child: Bun.Subprocess<"pipe", "pipe", "pipe">,
  lines: AsyncGenerator<string>,
  payload: { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown },
): Promise<JsonRpcResponse> {
  await writeLine(child, JSON.stringify(payload));
  while (true) {
    const { done, value: line } = await lines.next();
    if (done) break;
    const parsed = parseLine(line);
    if (!parsed || parsed.id !== payload.id) continue;
    return parsed;
  }
  throw new Error("STDIO stream closed before response was received");
}

async function writeLine(child: Bun.Subprocess<"pipe", "pipe", "pipe">, line: string): Promise<void> {
  child.stdin.write(`${line}\n`);
  await child.stdin.flush();
}

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) yield buffer;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) yield line;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): JsonRpcResponse | undefined {
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? (parsed as JsonRpcResponse) : undefined;
  } catch {
    return undefined;
  }
}

async function closeChild(child: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
  try {
    child.stdin.end();
  } catch {
    // ignore close races
  }
  const killTimer = setTimeout(() => child.kill(), 2000);
  await child.exited.catch(() => undefined);
  clearTimeout(killTimer);
}

async function readableText(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

function jsonErrorMessage(value: unknown): string {
  if (typeof value === "object" && value !== null && "message" in value) return String(value.message);
  return String(value);
}

function stripFinalNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}
