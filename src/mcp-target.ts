import type { McpHttpTarget } from "./config.ts";
import { die } from "./errors.ts";
import { getStoredAuthHeaders, handleOAuth401, refreshIfExpiring } from "./oauth.ts";
import type { TargetResult } from "./output.ts";
import { buildAliasSection } from "./alias.ts";

// --- JSON-RPC 타입 ---

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string };
};

// --- MCP 타입 ---

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type McpContent = {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
};

type McpCallResult = {
  content: McpContent[];
  isError?: boolean;
};

// --- SSE 파싱 ---

function parseSSE(body: string, expectedId: number): unknown {
  const lines = body.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    const data = line.slice(6).trim();
    try {
      const parsed = JSON.parse(data) as JsonRpcResponse;
      if (parsed.id === expectedId) return parsed;
    } catch {
      // non-JSON 라인(heartbeat 등) 무시
    }
  }
  // 매칭 id 없으면 마지막 data: 반환
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line && line.startsWith("data: ")) {
      const data = line.slice(6).trim();
      try {
        return JSON.parse(data);
      } catch {
        continue;
      }
    }
  }
  die("No JSON-RPC response found in SSE stream");
}

// --- HTTP 클라이언트 ---

type McpSession = {
  url: string;
  headers: Record<string, string>;
  sessionId: string | null;
  nextId: number;
  targetName: string;
  oauthEnabled: boolean;
};

async function mcpPost(session: McpSession, body: JsonRpcRequest, isRetry = false): Promise<unknown> {
  // 만료 임박 토큰 사전 갱신 (retry에서는 skip — 이미 처리됨)
  if (session.oauthEnabled && !isRetry) {
    const refreshed = await refreshIfExpiring(session.targetName);
    if (refreshed) Object.assign(session.headers, refreshed);
  }

  const reqHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...session.headers,
  };
  if (session.sessionId) {
    reqHeaders["Mcp-Session-Id"] = session.sessionId;
  }

  const resp = await fetch(session.url, {
    method: "POST",
    headers: reqHeaders,
    body: JSON.stringify(body),
  }).catch((e: unknown) => {
    die(`Failed to connect to MCP server at ${session.url}: ${e}`);
  });

  // 세션 ID 캡처
  const sid = resp.headers.get("Mcp-Session-Id");
  if (sid) session.sessionId = sid;

  // 401: OAuth 플로우 트리거 (1회만)
  if (resp.status === 401 && session.oauthEnabled && !isRetry) {
    const authHeaders = await handleOAuth401(session.targetName, session.url, resp);
    Object.assign(session.headers, authHeaders);
    return mcpPost(session, body, true);
  }

  const text = await resp.text();

  if (!resp.ok && resp.status !== 202) {
    die(`MCP server returned HTTP ${resp.status}: ${text}`);
  }

  // notification은 응답 바디 없음(204/202)
  if (!text.trim()) return null;

  const contentType = resp.headers.get("Content-Type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return parseSSE(text, body.id ?? -1);
  }

  try {
    return JSON.parse(text);
  } catch {
    die(`Failed to parse MCP response: ${text}`);
  }
}

function nextId(session: McpSession): number {
  return session.nextId++;
}

async function mcpCall(session: McpSession, method: string, params?: unknown): Promise<unknown> {
  const id = nextId(session);
  const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
  const raw = (await mcpPost(session, req)) as JsonRpcResponse | null;
  if (!raw) return null;
  if (raw.error) die(`MCP error ${raw.error.code}: ${raw.error.message}`);
  return raw.result;
}

async function mcpNotify(session: McpSession, method: string, params?: unknown): Promise<void> {
  const req: JsonRpcRequest = { jsonrpc: "2.0", method, params };
  await mcpPost(session, req);
}

// --- Tool 인자 파싱 ---

export function parseToolArgs(rawArgs: string[], inputSchema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const props = (inputSchema["properties"] as Record<string, { type?: string | string[] }> | undefined) ?? {};

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i] ?? "";

    const eqIdx = arg.indexOf("=");
    let key: string;
    let rawVal: string | undefined;

    if (arg.startsWith("--")) {
      if (eqIdx >= 0) {
        key = arg.slice(2, eqIdx);
        rawVal = arg.slice(eqIdx + 1);
        i++;
      } else {
        key = arg.slice(2);
        const next = rawArgs[i + 1];
        if (!next || next.startsWith("--")) {
          result[key] = true;
          i++;
          continue;
        }
        rawVal = next;
        i += 2;
      }
    } else if (eqIdx > 0) {
      // key=value 형식
      key = arg.slice(0, eqIdx);
      rawVal = arg.slice(eqIdx + 1);
      i++;
    } else {
      i++;
      continue;
    }

    // inputSchema를 기반으로 타입 변환
    const propDef = props[key];
    const propType = Array.isArray(propDef?.type) ? propDef.type[0] : propDef?.type;

    if (propType === "number" || propType === "integer") {
      result[key] = Number(rawVal);
    } else if (propType === "boolean") {
      result[key] = rawVal === "true" || rawVal === "1";
    } else if (propType === "string") {
      result[key] = rawVal;
    } else if (propType === "object" || propType === "array") {
      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        result[key] = rawVal;
      }
    } else {
      // 타입 정보 없음(any) 등: JSON 파싱 성공 시 그 값, 실패 시 원본 문자열
      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        result[key] = rawVal;
      }
    }
  }

  return result;
}

// --- MCP target 실행 ---

function buildMcpCurlCommand(url: string, headers: Record<string, string>, body: string): string {
  const parts = [`curl -X POST '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${k}: ${v}'`);
  }
  parts.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
  return `${parts.join(" \\\n")}\n`;
}

export async function executeMcp(
  target: McpHttpTarget,
  globalHeaders: Record<string, string> | undefined,
  toolName: string,
  rawArgs: string[],
  targetName: string,
  dryRun = false,
): Promise<TargetResult> {
  const oauthEnabled = target.auth === "oauth";

  if (dryRun && toolName !== "tools") {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(globalHeaders ?? {}),
      ...(target.headers ?? {}),
    };
    if (oauthEnabled) {
      const stored = await getStoredAuthHeaders(targetName);
      if (stored) Object.assign(headers, stored);
    }
    const toolArgs = parseToolArgs(rawArgs, {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    });
    return { exitCode: 0, stdout: buildMcpCurlCommand(target.url, headers, body), stderr: "" };
  }

  const session: McpSession = {
    url: target.url,
    headers: { ...(globalHeaders ?? {}), ...(target.headers ?? {}) },
    sessionId: null,
    nextId: 1,
    targetName,
    oauthEnabled,
  };

  // 저장된 OAuth 토큰 미리 로드
  if (oauthEnabled) {
    const storedHeaders = await getStoredAuthHeaders(targetName);
    if (storedHeaders) Object.assign(session.headers, storedHeaders);
  }

  // 1. Initialize
  await mcpCall(session, "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "clip", version: "0.1.0" },
  });

  // 2. notifications/initialized
  await mcpNotify(session, "notifications/initialized");

  // 3. tools/list — help 출력 또는 schema 획득
  const toolsResult = (await mcpCall(session, "tools/list")) as { tools: McpTool[] };
  const tools: McpTool[] = toolsResult?.tools ?? [];

  if (toolName === "tools") {
    // 목록 출력 모드
    if (tools.length === 0) {
      return { exitCode: 0, stdout: `No tools available.${buildAliasSection(target)}\n`, stderr: "" };
    }
    const lines = tools.map((t) => {
      const desc = t.description.length > 60 ? `${t.description.slice(0, 57)}...` : t.description;
      return `  ${t.name.padEnd(24)} ${desc}`;
    });
    return { exitCode: 0, stdout: `Tools:\n${lines.join("\n")}\n${buildAliasSection(target)}`, stderr: "" };
  }

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Tool "${toolName}" not found. Run: clip <target> tools\n`,
    };
  }

  // --help: tool 파라미터 출력
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    return formatToolHelp(tool);
  }

  // 4. tools/call
  const toolArgs = parseToolArgs(rawArgs, tool.inputSchema);
  const callResult = (await mcpCall(session, "tools/call", {
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
  const stderr = callResult?.isError ? stdout : "";

  return { exitCode, stdout: callResult?.isError ? "" : stdout, stderr };
}

export function formatToolHelp(tool: { name: string; description: string; inputSchema: Record<string, unknown> }): TargetResult {
  const schema = tool.inputSchema;
  const props = (schema["properties"] as Record<string, { type?: unknown; default?: unknown }> | undefined) ?? {};
  const required = new Set((schema["required"] as string[] | undefined) ?? []);

  const lines = [`Usage: clip <target> ${tool.name} [--param value ...]`, "", tool.description];

  if (Object.keys(props).length > 0) {
    lines.push("", "Parameters:");
    for (const [name, prop] of Object.entries(props).sort()) {
      const type = Array.isArray(prop.type) ? prop.type.filter((t) => t !== "null").join("|") : String(prop.type ?? "any");
      const req = required.has(name) ? " (required)" : "";
      const def = prop.default != null ? `  [default: ${prop.default}]` : "";
      lines.push(`  --${name.padEnd(22)} ${type}${req}${def}`);
    }
  }

  return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
