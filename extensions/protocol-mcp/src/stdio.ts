import {
  ClipError,
  die,
  formatToolHelp,
  parseToolArgs as parseToolArgsTyped,
  resolveTargetTimeoutMs,
  targetTimeoutMessage,
} from "@clip/core";
import type { ExecutorContext, TargetResult } from "@clip/core";
import { isMcpIntrospectionSubcommand, maybeFormatMcpIntrospection } from "./introspection.ts";
import type { McpStdioTarget } from "./schema.ts";
import { readToolsCache, writeToolsCache } from "./tools-cache.ts";

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

type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type McpCallResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
};

// --- STDIO 라인 스트림 ---

async function* readLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) yield buffer;
        break;
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

// --- shell 인용 ---

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@,+]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// --- 세션 실행 ---

type SendFn = (req: JsonRpcRequest) => Promise<JsonRpcResponse>;

async function runStdioSession<T>(target: McpStdioTarget, action: (send: SendFn) => Promise<T>): Promise<T> {
  const timeoutMs = resolveTargetTimeoutMs(target);
  const proc = Bun.spawn({
    cmd: [target.command, ...(target.args ?? [])],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...(target.env ?? {}) } as Record<string, string>,
  });

  const lineGen = readLines(proc.stdout as ReadableStream<Uint8Array>);
  let nextId = 1;

  const write = async (data: string): Promise<void> => {
    proc.stdin.write(`${data}\n`);
    await proc.stdin.flush();
  };

  const send: SendFn = async (req) => {
    const id = nextId++;
    await write(JSON.stringify({ ...req, id }));

    let timeoutHandle: ReturnType<typeof setTimeout>;
    const deadline = new Promise<JsonRpcResponse>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        proc.kill();
        reject(new ClipError(targetTimeoutMessage("MCP STDIO request", timeoutMs), 124));
      }, timeoutMs);
    });

    const findResponse = async (): Promise<JsonRpcResponse> => {
      // for-await 대신 next() 직접 호출 — loop 탈출 시 generator.return()이 호출되어
      // ReadableStream이 닫히는 것을 방지 (동일 generator를 여러 send()에서 재사용)
      while (true) {
        const { done, value } = await lineGen.next();
        if (done) throw new Error("STDIO stream closed before response was received");
        if (!value) continue;
        try {
          const parsed = JSON.parse(value) as JsonRpcResponse;
          if (parsed.id === id) {
            clearTimeout(timeoutHandle);
            return parsed;
          }
          // id 불일치(notification 등)는 무시
        } catch {
          /* non-JSON 무시 */
        }
      }
    };

    return Promise.race<JsonRpcResponse>([findResponse(), deadline]);
  };

  try {
    // initialize
    const initResp = await send({
      jsonrpc: "2.0",
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "clip", version: "0.1.0" },
      },
    });
    if (initResp.error) die(`MCP initialize error: ${initResp.error.message}`);

    // notifications/initialized (응답 없는 notification)
    await write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));

    return await action(send);
  } finally {
    try {
      proc.stdin.end();
    } catch {
      /* ignore */
    }
    const killTimer = setTimeout(() => proc.kill(), 2_000);
    await proc.exited;
    clearTimeout(killTimer);
  }
}

// --- 공개 API ---

export async function executeMcpStdio(target: McpStdioTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { subcommand, args, dryRun, targetName, jsonMode } = ctx;
  const hasHelp = args.includes("--help") || args.includes("-h");

  if (dryRun && !isMcpIntrospectionSubcommand(subcommand)) {
    const cachedTools = await readToolsCache(targetName).catch(() => null);
    const cachedTool = cachedTools?.find((tool) => tool.name === subcommand);
    const toolArgs = parseToolArgsTyped(args, cachedTool?.inputSchema ?? {});
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: subcommand, arguments: toolArgs },
    });
    const cmd = [target.command, ...(target.args ?? [])].map(shellQuote).join(" ");
    return { exitCode: 0, stdout: `echo '${payload.replace(/'/g, "'\\''")}' | ${cmd}\n`, stderr: "" };
  }

  return await runStdioSession(target, async (send) => {
    const toolsResp = await send({ jsonrpc: "2.0", method: "tools/list" });
    if (toolsResp.error) die(`tools/list error: ${toolsResp.error.message}`);
    const toolsResult = toolsResp.result as { tools: McpTool[] };
    const tools = toolsResult.tools ?? [];
    await writeToolsCache(targetName, tools).catch(() => {});

    const introspection = maybeFormatMcpIntrospection(subcommand, args, tools, target, targetName, jsonMode, 30);
    if (introspection) return introspection;

    if (hasHelp) {
      const tool = tools.find((t) => t.name === subcommand);
      if (!tool) {
        return { exitCode: 1, stdout: "", stderr: `Tool "${subcommand}" not found. Run: clip ${targetName} tools\n` };
      }
      return formatToolHelp(tool);
    }

    const toolName = subcommand;
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return { exitCode: 1, stdout: "", stderr: `Tool "${toolName}" not found. Run: clip ${targetName} tools\n` };
    }

    const toolArgs = parseToolArgsTyped(args, tool.inputSchema);
    const resp = await send({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: toolName, arguments: toolArgs },
    });
    if (resp.error) die(`tools/call error: ${resp.error.message}`);
    const result = resp.result as McpCallResult;
    const text = (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n");
    return { stdout: result.isError ? "" : text, stderr: result.isError ? text : "", exitCode: result.isError ? 1 : 0 };
  });
}
