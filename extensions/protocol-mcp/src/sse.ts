import { AuthenticatedClient, resolveAuthDir } from "@clip/auth";
import { buildAliasSection, die, formatToolHelp, parseToolArgs } from "@clip/core";
import type { ExecutorContext, TargetResult } from "@clip/core";
import type { McpSseTarget } from "./schema.ts";
import { writeToolsCache } from "./tools-cache.ts";

// --- JSON-RPC 타입 ---

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type McpCallResult = {
  content: { type: string; text?: string; data?: string; mimeType?: string }[];
  isError?: boolean;
};

// --- SSE 스트림 파서 ---
// 이벤트 블록은 \n\n 으로 구분, 각 라인은 "field: value" 형식

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n|\r/g, "\n");

      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";

      for (const block of blocks) {
        let event = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length > 0) yield { event, data: dataLines.join("\n") };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// --- SSE 세션 ---

type PendingEntry = { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void };

type SseSession = {
  call: (method: string, params?: unknown) => Promise<unknown>;
  notify: (method: string, params?: unknown) => Promise<void>;
  close: () => void;
};

async function openSseSession(
  target: McpSseTarget,
  targetName: string,
  externalHeaders: Record<string, string> = {},
): Promise<SseSession> {
  const oauthEnabled = target.auth === "oauth";
  const client = new AuthenticatedClient({
    targetName,
    targetType: "mcp",
    serverUrl: target.url,
    oauthEnabled,
    configDir: resolveAuthDir(targetName, "mcp"),
  });

  const authHeaders = await client.getAuthHeaders();
  const connectHeaders: Record<string, string> = {
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
    ...(target.headers ?? {}),
    ...externalHeaders,
    ...authHeaders,
  };

  const sseResp = await client.fetch(target.url, { headers: connectHeaders }).catch((e: unknown) => {
    die(`Failed to connect to SSE endpoint at ${target.url}: ${e}`);
  });

  if (!sseResp.ok) die(`SSE endpoint returned HTTP ${sseResp.status}`);
  if (!sseResp.body) die("SSE endpoint returned no body");

  const baseUrl = new URL(target.url);
  const pending = new Map<number, PendingEntry>();
  let idCounter = 1;
  let endpointSettled = false;

  // definite assignment — Promise 생성자가 동기적으로 실행하므로 안전
  let endpointResolve!: (url: string) => void;
  let endpointReject!: (e: Error) => void;
  const endpointPromise = new Promise<string>((res, rej) => {
    endpointResolve = res;
    endpointReject = rej;
  });

  // 백그라운드 SSE 스트림 리더
  (async () => {
    try {
      for await (const { event, data } of parseSseStream(sseResp.body!)) {
        if (event === "endpoint" && !endpointSettled) {
          endpointSettled = true;
          const url = data.startsWith("http") ? data : new URL(data, baseUrl).toString();
          endpointResolve(url);
        } else if (event === "message") {
          try {
            const parsed = JSON.parse(data) as JsonRpcResponse;
            if (parsed.id != null) {
              const p = pending.get(parsed.id as number);
              if (p) {
                pending.delete(parsed.id as number);
                p.resolve(parsed);
              }
            }
          } catch {
            /* non-JSON 무시 */
          }
        }
      }
    } catch (e) {
      if (!endpointSettled) {
        endpointSettled = true;
        endpointReject(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      const err = new Error("SSE connection closed");
      for (const [, p] of pending) p.reject(err);
      pending.clear();
    }
  })();

  const timeoutId = setTimeout(
    () => endpointReject?.(new Error("Timeout (10s) waiting for SSE endpoint event")),
    10_000,
  );
  const messageUrl = await endpointPromise;
  clearTimeout(timeoutId);

  const postBaseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(target.headers ?? {}),
    ...externalHeaders,
  };

  const call = async (method: string, params?: unknown): Promise<unknown> => {
    const id = idCounter++;
    // 응답 promise를 POST 전에 등록 (race condition 방지)
    const responsePromise = new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Timeout waiting for response (id=${id})`));
        }
      }, 30_000);
    });

    const postResp = await client.fetch(messageUrl, {
      method: "POST",
      headers: postBaseHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }).catch((e: unknown) => die(`SSE POST failed: ${e}`));

    if (!postResp.ok && postResp.status !== 202) {
      die(`SSE message endpoint returned HTTP ${postResp.status}: ${await postResp.text()}`);
    }

    const raw = await responsePromise;
    if (raw.error) die(`MCP error ${raw.error.code}: ${raw.error.message}`);
    return raw.result;
  };

  const notify = async (method: string, params?: unknown): Promise<void> => {
    await client.fetch(messageUrl, {
      method: "POST",
      headers: postBaseHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  };

  return { call, notify, close: () => sseResp.body!.cancel() };
}

// --- dry-run 헬퍼 ---

function buildSseDryRunOutput(target: McpSseTarget, headers: Record<string, string>, body: string): string {
  const headerArgs = Object.entries(headers)
    .map(([k, v]) => `  -H '${k}: ${v}'`)
    .join(" \\\n");
  return [
    "# Step 1: Connect to SSE endpoint",
    `curl -N '${target.url}' \\`,
    `  -H 'Accept: text/event-stream'${headerArgs ? " \\\n" + headerArgs : ""}`,
    "",
    "# Step 2: POST to message endpoint (URL from 'endpoint' SSE event)",
    `curl -X POST '<messageUrl-from-endpoint-event>' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${body.replace(/'/g, "'\\''")}'`,
    "",
  ].join("\n");
}

// --- 공개 API ---

export async function executeMcpSse(target: McpSseTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { headers: globalHeaders, subcommand: toolName, args: rawArgs, targetName, dryRun } = ctx;
  if (dryRun && toolName !== "tools") {
    const headers: Record<string, string> = { ...(globalHeaders ?? {}), ...(target.headers ?? {}) };
    const toolArgs = parseToolArgs(rawArgs, {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    });
    return { exitCode: 0, stdout: buildSseDryRunOutput(target, headers, body), stderr: "" };
  }

  const session = await openSseSession(target, targetName, globalHeaders);

  try {
    // initialize
    await session.call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "clip", version: "0.1.0" },
    });

    // notifications/initialized
    await session.notify("notifications/initialized");

    // tools/list
    const toolsResult = (await session.call("tools/list")) as { tools: McpTool[] };
    const tools: McpTool[] = toolsResult?.tools ?? [];

    await writeToolsCache(targetName, tools).catch(() => {});

    if (toolName === "refresh") {
      return { exitCode: 0, stdout: `Refreshed "${targetName}" schema (${tools.length} tools)\n`, stderr: "" };
    }

    if (toolName === "tools") {
      const scripts = buildAliasSection(target);
      if (tools.length === 0) return { exitCode: 0, stdout: `No tools available.${scripts}\n`, stderr: "" };
      const lines = tools.map((t) => {
        const desc = t.description.length > 60 ? `${t.description.slice(0, 57)}...` : t.description;
        return `  ${t.name.padEnd(24)} ${desc}`;
      });
      return { exitCode: 0, stdout: `Tools:\n${lines.join("\n")}\n${scripts}`, stderr: "" };
    }

    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return { exitCode: 1, stdout: "", stderr: `Tool "${toolName}" not found. Run: clip ${targetName} tools\n` };
    }

    if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
      return formatToolHelp(tool);
    }

    // tools/call
    const toolArgs = parseToolArgs(rawArgs, tool.inputSchema);
    const callResult = (await session.call("tools/call", {
      name: toolName,
      arguments: toolArgs,
    })) as McpCallResult;

    const parts: string[] = [];
    for (const c of callResult?.content ?? []) {
      if (c.type === "text" && c.text) {
        parts.push(c.text);
      } else if (c.type === "image" && c.data) {
        const ext = (c.mimeType ?? "image/png").split("/")[1] ?? "png";
        const path = `/tmp/clip-image-${Date.now()}.${ext}`;
        await Bun.write(path, Buffer.from(c.data, "base64"));
        parts.push(path);
      }
    }
    const stdout = parts.join("\n");
    const exitCode = callResult?.isError ? 1 : 0;
    return { exitCode, stdout: callResult?.isError ? "" : stdout, stderr: callResult?.isError ? stdout : "" };
  } finally {
    session.close();
  }
}
