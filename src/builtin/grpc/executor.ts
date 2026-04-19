import { mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { buildAliasSection } from "../../commands/alias.ts";
import { getStoredAuthHeaders, refreshIfExpiring } from "../../commands/oauth.ts";
import type { TargetResult, Tool } from "../../extension.ts";
import type { ExecutorContext } from "../../extension.ts";
import { buildJsonSchema, isWellKnownOrScalar, parseMessageDescribe, parseServiceDescribe } from "../../schema/grpc.ts";
import type { ParsedDescribe } from "../../schema/grpc.ts";
import { die } from "../../utils/errors.ts";
import { formatToolHelp, parseToolArgs } from "../../utils/tool-args.ts";
import type { GrpcTarget } from "./schema.ts";

const GRPC_DIR = join(homedir(), ".clip", "target", "grpc");

const HIDDEN_SERVICES = new Set(["grpc.reflection.v1.ServerReflection", "grpc.reflection.v1alpha.ServerReflection"]);

type GrpcMethod = {
  name: string;
  requestType: string;
  responseType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
  inputSchema: Record<string, unknown>;
};

type GrpcService = {
  name: string;
  methods: GrpcMethod[];
};

type GrpcSchemaCache = {
  services: GrpcService[];
};

function schemaCachePath(targetName: string): string {
  return join(GRPC_DIR, targetName, "schema.json");
}

async function ensureGrpcurl(): Promise<void> {
  const proc = Bun.spawn(["which", "grpcurl"], { stdout: "pipe", stderr: "pipe" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    die(
      "grpcurl not found in PATH.\n" +
        "Install: brew install grpcurl\n" +
        "Or:      go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest\n" +
        "Requires grpcurl 1.8.7+ for gRPC reflection v1 support.",
    );
  }
}

async function spawnGrpcurl(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["grpcurl", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

function makeBaseFlags(target: GrpcTarget): string[] {
  const flags: string[] = [];
  if (target.plaintext) flags.push("-plaintext");
  if (target.importPaths?.length && !target.proto) {
    process.stderr.write(`clip: warning: "importPaths" is set but "proto" is not — importPaths will be ignored\n`);
  }
  if (target.proto) {
    flags.push("-proto", target.proto);
    for (const ip of target.importPaths ?? []) flags.push("-import-path", ip);
  }
  return flags;
}

function makeReflectFlags(target: GrpcTarget, token?: string): string[] {
  const meta = { ...(target.reflectMetadata ?? target.metadata ?? {}) };
  if (token) meta["authorization"] = `Bearer ${token}`;
  return Object.entries(meta).flatMap(([k, v]) => ["-reflect-header", `${k}: ${v}`]);
}

function makeRpcFlags(target: GrpcTarget, token?: string): string[] {
  const flags = ["-format-error", "-max-time", String(target.deadline ?? 30)];
  if (target.emitDefaults !== false) flags.push("-emit-defaults");
  if (target.allowUnknownFields) flags.push("-allow-unknown-fields");
  const meta = { ...(target.metadata ?? {}) };
  if (token) meta["authorization"] = `Bearer ${token}`;
  for (const [k, v] of Object.entries(meta)) flags.push("-rpc-header", `${k}: ${v}`);
  return flags;
}

function validateTls(target: GrpcTarget): void {
  if (target.plaintext && target.address.endsWith(":443")) {
    die(`TLS is required on port 443. Remove "plaintext: true" from config.\n` + `Address: ${target.address}`);
  }
}

function warnMetadata(metadata: Record<string, string> | undefined): void {
  for (const key of Object.keys(metadata ?? {})) {
    if (key.startsWith("grpc-") || key.startsWith(":")) {
      process.stderr.write(`clip: warning: metadata key "${key}" has reserved prefix\n`);
    } else if (key !== key.toLowerCase()) {
      process.stderr.write(`clip: warning: metadata key "${key}" should be lowercase ASCII\n`);
    }
  }
}

function tokenFromHeaders(headers: Record<string, string>): string | undefined {
  const val = headers["Authorization"] ?? headers["authorization"];
  return val?.replace(/^Bearer\s+/i, "");
}

async function getAuthToken(targetName: string): Promise<string | undefined> {
  const refreshed = await refreshIfExpiring(targetName, "grpc");
  if (refreshed?.["Authorization"]) return refreshed["Authorization"].replace(/^Bearer\s+/i, "");
  const stored = await getStoredAuthHeaders(targetName, "grpc");
  return stored?.["Authorization"]?.replace(/^Bearer\s+/i, "");
}

async function loadSchema(
  target: GrpcTarget,
  targetName: string,
  forceRefresh = false,
  authHeaders: Record<string, string> = {},
): Promise<GrpcSchemaCache> {
  const cachePath = schemaCachePath(targetName);
  const cacheFile = Bun.file(cachePath);

  if (!forceRefresh && (await cacheFile.exists())) {
    try {
      return JSON.parse(await cacheFile.text()) as GrpcSchemaCache;
    } catch {
      /* 손상 → 재로드 */
    }
  }

  warnMetadata(target.metadata);
  warnMetadata(target.reflectMetadata);

  const token = tokenFromHeaders(authHeaders) ?? (await getAuthToken(targetName));
  const baseFlags = makeBaseFlags(target);
  const reflectFlags = makeReflectFlags(target, token);

  // 1. Service 목록
  const listResult = await spawnGrpcurl([...baseFlags, ...reflectFlags, target.address, "list"]);
  if (listResult.exitCode !== 0) {
    die(
      `Failed to list gRPC services for "${targetName}":\n${listResult.stderr.trim()}\n\n` +
        `If reflection is disabled, add "proto: ./service.proto" to config.yml.`,
    );
  }

  const serviceNames = listResult.stdout
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. 각 service describe → method 파싱
  const parsedServiceMethods = new Map<string, ReturnType<typeof parseServiceDescribe>>();
  const typesToDescribe = new Set<string>();

  for (const svcName of serviceNames) {
    if (HIDDEN_SERVICES.has(svcName)) continue;
    const r = await spawnGrpcurl([...baseFlags, ...reflectFlags, target.address, "describe", svcName]);
    if (r.exitCode !== 0) continue;
    const methods = parseServiceDescribe(r.stdout);
    parsedServiceMethods.set(svcName, methods);
    for (const m of methods) {
      if (!isWellKnownOrScalar(m.requestType)) typesToDescribe.add(m.requestType);
    }
  }

  // 3. BFS: 모든 필요한 message type describe
  const knownTypes = new Map<string, ParsedDescribe>();
  const descSeen = new Set<string>();
  const queue = [...typesToDescribe];

  while (queue.length > 0) {
    const typeName = queue.shift()!;
    if (descSeen.has(typeName) || isWellKnownOrScalar(typeName)) continue;
    descSeen.add(typeName);

    const r = await spawnGrpcurl([...baseFlags, ...reflectFlags, target.address, "describe", typeName]);
    const parsed: ParsedDescribe = r.exitCode === 0 ? parseMessageDescribe(r.stdout) : { kind: "unknown" };
    knownTypes.set(typeName, parsed);

    if (parsed.kind === "message") {
      for (const field of parsed.fields) {
        const nested = field.isMap ? field.mapValueType : field.typeName;
        if (nested && !descSeen.has(nested) && !isWellKnownOrScalar(nested)) queue.push(nested);
      }
    }
  }

  // 4. GrpcSchemaCache 빌드
  const services: GrpcService[] = [];
  for (const [svcName, methods] of parsedServiceMethods) {
    services.push({
      name: svcName,
      methods: methods.map((pm) => ({
        name: pm.name,
        requestType: pm.requestType,
        responseType: pm.responseType,
        clientStreaming: pm.clientStreaming,
        serverStreaming: pm.serverStreaming,
        inputSchema: buildJsonSchema(pm.requestType, knownTypes),
      })),
    });
  }

  const cache: GrpcSchemaCache = { services };
  const dir = join(GRPC_DIR, targetName);
  mkdirSync(dir, { recursive: true });
  await Bun.write(cachePath, JSON.stringify(cache, null, 2));
  return cache;
}

function resolveMethod(
  schema: GrpcSchemaCache,
  subcommand: string,
): { service: GrpcService; method: GrpcMethod; fqn: string } | null {
  const parts = subcommand.split(".");
  const methodName = parts[parts.length - 1]!;
  const serviceHint = parts.length > 1 ? parts.slice(0, -1).join(".") : undefined;

  const matches: { service: GrpcService; method: GrpcMethod; fqn: string }[] = [];
  for (const svc of schema.services) {
    const svcShort = svc.name.split(".").pop()!;
    const matchesSvc =
      !serviceHint || svc.name === serviceHint || svcShort === serviceHint || svc.name.endsWith(`.${serviceHint}`);

    if (matchesSvc) {
      const method = svc.methods.find((m) => m.name === methodName);
      if (method) matches.push({ service: svc, method, fqn: `${svc.name}.${methodName}` });
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    const fqns = matches.map((m) => m.fqn).join(", ");
    process.stderr.write(
      `[clip] warning: ambiguous method "${subcommand}", using first match. Use full name to disambiguate: ${fqns}\n`,
    );
  }
  return matches[0]!;
}

function toolDisplayName(svc: GrpcService, method: GrpcMethod, multiService: boolean): string {
  if (!multiService) return method.name;
  return `${svc.name.split(".").pop()}.${method.name}`;
}

export async function executeGrpc(target: GrpcTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { subcommand, args: rawArgs, targetName, headers: ctxHeaders } = ctx;
  const forceRefresh = subcommand === "refresh";
  await ensureGrpcurl();
  validateTls(target);

  if (subcommand === "refresh") {
    const schema = await loadSchema(target, targetName, true, ctxHeaders);
    const total = schema.services.reduce((n, s) => n + s.methods.length, 0);
    return {
      exitCode: 0,
      stdout: `Refreshed "${targetName}" schema (${schema.services.length} services, ${total} methods)\n`,
      stderr: "",
    };
  }

  const schema = await loadSchema(target, targetName, forceRefresh, ctxHeaders);

  if (subcommand === "tools") {
    const visible = schema.services.filter((s) => !HIDDEN_SERVICES.has(s.name));
    if (visible.length === 0) return { exitCode: 0, stdout: "No methods available.\n", stderr: "" };
    const multiService = visible.length > 1;
    const lines = ["Methods:"];
    for (const svc of visible) {
      for (const m of svc.methods) {
        const name = toolDisplayName(svc, m, multiService);
        const tags: string[] = [];
        if (m.serverStreaming) tags.push("server-stream");
        if (m.clientStreaming) tags.push("client-stream");
        const suffix = tags.length ? `  [${tags.join(", ")}]` : "";
        const reqShort = m.requestType.split(".").pop() ?? m.requestType;
        lines.push(`  ${name.padEnd(28)} ${reqShort}${suffix}`);
      }
    }
    return { exitCode: 0, stdout: `${lines.join("\n")}\n${buildAliasSection(target)}`, stderr: "" };
  }

  if (subcommand === "describe") {
    const arg = rawArgs[0];
    if (!arg) {
      const visible = schema.services.filter((s) => !HIDDEN_SERVICES.has(s.name));
      const lines = visible.map((s) => `  ${s.name}  (${s.methods.length} methods)`);
      return { exitCode: 0, stdout: `Services:\n${lines.join("\n")}\n`, stderr: "" };
    }

    // Method 매칭 먼저
    const resolved = resolveMethod(schema, arg);
    if (resolved) {
      const { method, fqn } = resolved;
      const streaming = method.serverStreaming
        ? " (server streaming — not supported in v1)"
        : method.clientStreaming
          ? " (client streaming — not supported in v1)"
          : "";
      const tool = {
        name: arg,
        description: `gRPC: ${fqn}${streaming}\nRequest:  ${method.requestType}\nResponse: ${method.responseType}`,
        inputSchema: method.inputSchema,
      };
      return formatToolHelp(tool);
    }

    // Service 매칭
    const svc = schema.services.find((s) => {
      const short = s.name.split(".").pop()!;
      return s.name === arg || short === arg || s.name.endsWith(`.${arg}`);
    });
    if (svc) {
      const lines = [`Service: ${svc.name}`, ""];
      for (const m of svc.methods) {
        const tag = m.serverStreaming ? " [server-stream]" : m.clientStreaming ? " [client-stream]" : "";
        lines.push(`  ${m.name}${tag}`);
        lines.push(`    Request:  ${m.requestType}`);
        lines.push(`    Response: ${m.responseType}`);
      }
      return { exitCode: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
    }

    return {
      exitCode: 1,
      stdout: "",
      stderr: `"${arg}" not found. Run: clip ${targetName} tools\n`,
    };
  }

  // RPC 호출
  const resolved = resolveMethod(schema, subcommand);
  if (!resolved) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Method "${subcommand}" not found. Run: clip ${targetName} tools\n`,
    };
  }

  const { method, fqn } = resolved;

  if (method.serverStreaming || method.clientStreaming) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Streaming RPCs are not supported in v1. Use grpcurl directly:\n  grpcurl ... ${target.address} ${fqn}\n`,
    };
  }

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    const streaming = method.serverStreaming || method.clientStreaming ? " (streaming — v1 unsupported)" : "";
    return formatToolHelp({
      name: subcommand,
      description: `gRPC: ${fqn}${streaming}\nRequest:  ${method.requestType}\nResponse: ${method.responseType}`,
      inputSchema: method.inputSchema,
    });
  }

  const args = parseToolArgs(rawArgs, method.inputSchema);
  const body = Object.keys(args).length > 0 ? args : {};
  const token = tokenFromHeaders(ctxHeaders);
  const baseFlags = makeBaseFlags(target);
  const rpcFlags = makeRpcFlags(target, token);

  const result = await spawnGrpcurl([...baseFlags, ...rpcFlags, "-d", JSON.stringify(body), target.address, fqn]);

  if (result.exitCode === 0) {
    let stdout: string;
    try {
      stdout = JSON.stringify(JSON.parse(result.stdout), null, 2) + "\n";
    } catch {
      stdout = result.stdout;
    }
    return { exitCode: 0, stdout, stderr: "" };
  }

  // gRPC status code 추출
  const codeMatch = result.stderr.match(/Code:\s*(\w+)/);
  const grpcCode = codeMatch?.[1]?.toUpperCase();

  if (grpcCode === "UNAUTHENTICATED" && target.oauth) {
    const newToken = await getAuthToken(targetName);
    if (newToken) {
      const retry = await spawnGrpcurl([
        ...baseFlags,
        ...makeRpcFlags(target, newToken),
        "-d",
        JSON.stringify(body),
        target.address,
        fqn,
      ]);
      if (retry.exitCode === 0) {
        let stdout: string;
        try {
          stdout = JSON.stringify(JSON.parse(retry.stdout), null, 2) + "\n";
        } catch {
          stdout = retry.stdout;
        }
        return { exitCode: 0, stdout, stderr: "" };
      }
    }
    return {
      exitCode: 1,
      stdout: "",
      stderr: [
        "gRPC UNAUTHENTICATED. To set up auth:",
        "  Option 1: Add to config.yml:",
        "    metadata:",
        '      authorization: "Bearer <token>"',
        "  Option 2: Store token in ~/.clip/target/grpc/" + targetName + "/auth.json",
        "",
        result.stderr,
      ].join("\n"),
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: grpcCode ? `gRPC [${grpcCode}]: ${result.stderr}` : result.stderr,
  };
}

export async function describeGrpcTools(target: GrpcTarget, targetName: string): Promise<Tool[]> {
  await ensureGrpcurl();
  validateTls(target);
  const schema = await loadSchema(target, targetName);
  const visible = schema.services.filter((s) => !HIDDEN_SERVICES.has(s.name));
  const multiService = visible.length > 1;
  return visible.flatMap((svc) =>
    svc.methods.map((m) => ({
      name: multiService ? `${svc.name.split(".").pop()}.${m.name}` : m.name,
      description: `${m.requestType} → ${m.responseType}`,
      inputSchema: m.inputSchema,
    })),
  );
}
