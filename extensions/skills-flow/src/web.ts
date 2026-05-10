import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { die } from "@clip/core";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, type ViteDevServer, createServer } from "vite";
import { type Frontmatter, parseFrontmatter } from "./frontmatter.ts";

type WebOptions = {
  rootDir: string;
  host: string;
  port: number;
  portWasExplicit: boolean;
  loadPayload: (name?: string) => WebPayload;
  resolveDir: (name: string) => string | undefined;
};

type ValidationResult = {
  valid: boolean;
  status: "valid" | "warning" | "invalid";
  errors: unknown[];
  warnings: unknown[];
  flow?: { name?: unknown };
};

export type WebPackageSummary = {
  id: string;
  name: string;
  dir: string;
  description: string;
  status: "valid" | "warning" | "invalid";
  valid: boolean;
  nodes: number;
  edges: number;
};

export type LayoutDirection = "horizontal" | "vertical";

export type FlowUiPosition = {
  x: number;
  y: number;
};

export type FlowUiJson = {
  schemaVersion: "1";
  nodePositions: Record<string, Partial<Record<LayoutDirection, FlowUiPosition>>>;
};

export type WebPayload = {
  name: string;
  dir: string;
  rootDir: string;
  selectedId: string | null;
  packages: WebPackageSummary[];
  frontmatter: Frontmatter;
  description: string;
  validation: Pick<ValidationResult, "valid" | "status" | "errors" | "warnings">;
  flow: unknown;
  flowUi: FlowUiJson;
};

function webRoot(): string {
  return resolve(fileURLToPath(new URL("../web", import.meta.url)));
}

function readFrontmatter(dir: string): Frontmatter {
  const skillPath = resolve(dir, "SKILL.md");
  if (!existsSync(skillPath)) return {};
  const parsed = parseFrontmatter(readFileSync(skillPath, "utf8"));
  return parsed.ok ? parsed.frontmatter : {};
}

function emptyFlowUi(): FlowUiJson {
  return { schemaVersion: "1", nodePositions: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePosition(value: unknown): FlowUiPosition | undefined {
  if (!isRecord(value)) return undefined;
  const x = value.x;
  const y = value.y;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}

function normalizeFlowUi(value: unknown): FlowUiJson {
  if (!isRecord(value)) return emptyFlowUi();
  const nodePositions = isRecord(value.nodePositions) ? value.nodePositions : {};
  const next = emptyFlowUi();

  for (const [nodeId, rawDirections] of Object.entries(nodePositions)) {
    if (!nodeId || !isRecord(rawDirections)) continue;
    const horizontal = normalizePosition(rawDirections.horizontal);
    const vertical = normalizePosition(rawDirections.vertical);
    if (horizontal || vertical) next.nodePositions[nodeId] = { horizontal, vertical };
  }

  return next;
}

export function readFlowUi(dir: string): FlowUiJson {
  const file = resolve(dir, "flow-ui.json");
  if (!existsSync(file)) return emptyFlowUi();

  try {
    return normalizeFlowUi(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return emptyFlowUi();
  }
}

export function mergeFlowUi(dir: string, patch: unknown): FlowUiJson {
  if (!isRecord(patch) || !isRecord(patch.nodePositions)) {
    throw new Error("flow-ui patch must include nodePositions");
  }

  const current = readFlowUi(dir);
  const next: FlowUiJson = {
    schemaVersion: "1",
    nodePositions: { ...current.nodePositions },
  };

  for (const [nodeId, rawDirections] of Object.entries(patch.nodePositions)) {
    if (!nodeId || !isRecord(rawDirections)) continue;
    const currentNode = next.nodePositions[nodeId] ?? {};
    const updatedNode = { ...currentNode };
    const horizontal = normalizePosition(rawDirections.horizontal);
    const vertical = normalizePosition(rawDirections.vertical);
    if (horizontal) updatedNode.horizontal = horizontal;
    if (vertical) updatedNode.vertical = vertical;
    if (updatedNode.horizontal || updatedNode.vertical) next.nodePositions[nodeId] = updatedNode;
  }

  writeFileSync(resolve(dir, "flow-ui.json"), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function buildWebPayload(
  name: string | null,
  dir: string | null,
  result: ValidationResult | null,
  packages: WebPackageSummary[],
  rootDir: string,
): WebPayload {
  const frontmatter = dir ? readFrontmatter(dir) : {};
  const description = typeof frontmatter.description === "string" ? frontmatter.description : "";
  return {
    name: typeof result?.flow?.name === "string" ? result.flow.name : (name ?? ""),
    dir: dir ?? "",
    rootDir,
    selectedId: dir ? (packages.find((item) => item.dir === dir)?.id ?? null) : null,
    packages,
    frontmatter,
    description,
    validation: {
      valid: result?.valid ?? true,
      status: result?.status ?? "valid",
      errors: result?.errors ?? [],
      warnings: result?.warnings ?? [],
    },
    flow: result?.flow ?? null,
    flowUi: dir ? readFlowUi(dir) : emptyFlowUi(),
  };
}

function readLinkedMarkdown(dir: string, link: string): { status: number; contentType: string; body: string } {
  if (isAbsolute(link) || extname(link) !== ".md") {
    return jsonResponse(400, { error: "link must be a relative .md path" });
  }

  const abs = resolve(dir, link);
  const rel = relative(dir, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return jsonResponse(400, { error: "link must stay inside the skill folder" });
  }

  if (!existsSync(abs)) {
    return jsonResponse(404, { error: "linked markdown file not found" });
  }

  return {
    status: 200,
    contentType: "text/markdown; charset=utf-8",
    body: readFileSync(abs, "utf8"),
  };
}

function jsonResponse(status: number, value: unknown): { status: number; contentType: string; body: string } {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(value, null, 2),
  };
}

function send(
  res: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void },
  out: { status: number; contentType: string; body: string },
): void {
  res.statusCode = out.status;
  res.setHeader("content-type", out.contentType);
  res.end(out.body);
}

function readRequestBody(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("request body is too large"));
    });
    req.on("end", () => resolvePromise(body));
    req.on("error", reject);
  });
}

function skillsFlowApiPlugin(opts: WebOptions): Plugin {
  return {
    name: "skills-flow-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://skills-flow.local");
        if (url.pathname === "/api/flow") {
          send(res, jsonResponse(200, opts.loadPayload(url.searchParams.get("name") ?? undefined)));
          return;
        }
        if (url.pathname === "/api/flow-ui") {
          if (req.method !== "POST") {
            send(res, jsonResponse(405, { error: "method not allowed" }));
            return;
          }
          const name = url.searchParams.get("name");
          if (!name) {
            send(res, jsonResponse(400, { error: "missing name" }));
            return;
          }
          const dir = opts.resolveDir(name);
          if (!dir) {
            send(res, jsonResponse(404, { error: "skills-flow package not found" }));
            return;
          }

          try {
            const body = await readRequestBody(req);
            const flowUi = mergeFlowUi(dir, JSON.parse(body));
            send(res, jsonResponse(200, { ok: true, flowUi }));
          } catch (error: unknown) {
            send(res, jsonResponse(400, { error: error instanceof Error ? error.message : String(error) }));
          }
          return;
        }
        if (url.pathname === "/api/link") {
          const name = url.searchParams.get("name");
          const link = url.searchParams.get("path");
          if (!name) {
            send(res, jsonResponse(400, { error: "missing name" }));
            return;
          }
          if (!link) {
            send(res, jsonResponse(400, { error: "missing path" }));
            return;
          }
          const dir = opts.resolveDir(name);
          if (!dir) {
            send(res, jsonResponse(404, { error: "skills-flow package not found" }));
            return;
          }
          send(res, readLinkedMarkdown(dir, link));
          return;
        }
        next();
      });
    },
  };
}

async function startVite(opts: WebOptions, port: number): Promise<ViteDevServer> {
  const server = await createServer({
    root: webRoot(),
    appType: "spa",
    clearScreen: false,
    logLevel: "silent",
    plugins: [skillsFlowApiPlugin(opts), react(), tailwindcss()],
    server: {
      host: opts.host,
      port,
      strictPort: opts.portWasExplicit,
    },
  });
  await server.listen();
  return server;
}

function serverPort(server: ViteDevServer, fallback: number): number {
  const address = server.httpServer?.address();
  if (typeof address === "object" && address?.port) return address.port;
  return fallback;
}

export async function serveSkillsFlowWeb(opts: WebOptions): Promise<void> {
  let server: ViteDevServer;
  try {
    server = await startVite(opts, opts.port);
  } catch (e) {
    if (opts.portWasExplicit) throw e;
    server = await startVite(opts, 0);
  }

  const port = serverPort(server, opts.port);
  const url = `http://${opts.host}:${port}`;
  console.log(`skills-flow web: ${url}`);
  console.log(`root: ${opts.rootDir}`);
  console.log("Press Ctrl+C to stop.");

  await new Promise<void>((resolvePromise) => {
    const stop = async () => {
      await server.close();
      resolvePromise();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export function parseWebArgs(args: string[]): {
  name?: string;
  host: string;
  port: number;
  portWasExplicit: boolean;
} {
  let name: string | undefined;
  let host = "127.0.0.1";
  let port = 3907;
  let portWasExplicit = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--host") {
      host = args[++i] ?? die("--host requires a value");
    } else if (arg?.startsWith("--host=")) {
      host = arg.slice("--host=".length);
    } else if (arg === "--port") {
      port = Number(args[++i] ?? die("--port requires a value"));
      portWasExplicit = true;
    } else if (arg?.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
      portWasExplicit = true;
    } else if (!arg?.startsWith("-") && !name) {
      name = arg;
    } else if (!arg?.startsWith("-")) {
      die(`Unexpected argument: ${arg}`);
    } else {
      die(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isInteger(port) || port < 0 || port > 65535) die(`--port must be a valid port, got: ${port}`);
  return { name, host, port, portWasExplicit };
}
