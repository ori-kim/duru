import type { McpTarget } from "./config.ts";
import { die } from "./errors.ts";
import type { TargetResult } from "./output.ts";

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
};

async function mcpPost(session: McpSession, body: JsonRpcRequest): Promise<unknown> {
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

function parseToolArgs(rawArgs: string[], inputSchema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const props = (inputSchema["properties"] as Record<string, { type?: string | string[] }> | undefined) ?? {};

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i] ?? "";
    if (!arg.startsWith("--")) {
      i++;
      continue;
    }

    const eqIdx = arg.indexOf("=");
    let key: string;
    let rawVal: string | undefined;

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

    // inputSchema를 기반으로 타입 변환
    const propDef = props[key];
    const propType = Array.isArray(propDef?.type) ? propDef.type[0] : propDef?.type;

    if (propType === "number" || propType === "integer") {
      result[key] = Number(rawVal);
    } else if (propType === "boolean") {
      result[key] = rawVal === "true" || rawVal === "1";
    } else if (propType === "object" || propType === "array") {
      try {
        result[key] = JSON.parse(rawVal);
      } catch {
        result[key] = rawVal;
      }
    } else {
      // 기본: 숫자 JSON이면 자동 파싱, 아니면 문자열
      try {
        const parsed = JSON.parse(rawVal);
        result[key] = typeof parsed === "object" ? rawVal : parsed;
      } catch {
        result[key] = rawVal;
      }
    }
  }

  return result;
}

// --- MCP target 실행 ---

export async function executeMcp(
  target: McpTarget,
  globalHeaders: Record<string, string> | undefined,
  toolName: string,
  rawArgs: string[],
): Promise<TargetResult> {
  const session: McpSession = {
    url: target.url,
    headers: { ...(globalHeaders ?? {}), ...(target.headers ?? {}) },
    sessionId: null,
    nextId: 1,
  };

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
      return { exitCode: 0, stdout: "No tools available.\n", stderr: "" };
    }
    const lines = tools.map((t) => {
      const desc = t.description.length > 60 ? `${t.description.slice(0, 57)}...` : t.description;
      return `  ${t.name.padEnd(24)} ${desc}`;
    });
    return { exitCode: 0, stdout: `Tools:\n${lines.join("\n")}\n`, stderr: "" };
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

  const texts = (callResult?.content ?? []).filter((c) => c.type === "text" && c.text).map((c) => c.text ?? "");

  const stdout = texts.join("\n");
  const exitCode = callResult?.isError ? 1 : 0;
  const stderr = callResult?.isError ? stdout : "";

  return { exitCode, stdout: callResult?.isError ? "" : stdout, stderr };
}

function formatToolHelp(tool: McpTool): TargetResult {
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
