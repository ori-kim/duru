#!/usr/bin/env bun
import { checkAcl } from "./acl.ts";
import { executeApi } from "./api-target.ts";
import { BIND_DIR, bindTarget, listBound, unbindTarget } from "./bind.ts";
import { executeCli } from "./cli-target.ts";
import type { ApiTarget, CliTarget, GraphqlTarget, GrpcTarget, McpHttpTarget, McpSseTarget, McpStdioTarget, McpTarget } from "./config.ts";
import { addTarget, getTarget, loadConfig, removeTarget } from "./config.ts";
import { die } from "./errors.ts";
import { executeGraphql } from "./graphql-target.ts";
import { executeGrpc } from "./grpc-target.ts";
import { executeMcpStdio } from "./mcp-stdio-target.ts";
import { executeMcpSse } from "./mcp-sse-target.ts";
import { executeMcp } from "./mcp-target.ts";
import { forceLogin, getAuthStatus, removeTokens } from "./oauth.ts";
import { formatOutput } from "./output.ts";
import { runCompletionCmd } from "./completion.ts";
import { runProfileCmd, resolveProfile } from "./profile.ts";
import { runSkillsCmd } from "./skills.ts";

const VERSION = "0.6.4";

const HELP = `
clip — CLI proxy for MCP servers and CLI tools

Usage:
  clip [--json] [--pipe] <target> <subcommand> [...args]
  clip add <name> <command-or-url> [--allow x,y] [--deny z]
  clip add <name> <https://...openapi.json> [--api]
  clip add <name> <https://...> --sse
  clip remove <name>
  clip list
  clip refresh <target>
  clip login <target>
  clip logout <target>
  clip profile add <target> <profile> [--args a,b,c] [--url ...] [--env K=V]
  clip profile use <target> <profile>   Set active profile
  clip profile list <target>            List profiles
  clip profile remove <target> <profile>
  clip profile unset <target>           Remove active profile
  clip <target>@<profile> <args>        One-shot profile override
  clip bind <target>       Bind target as a native command (no "clip" prefix needed)
  clip unbind <target>     Remove native binding
  clip bind --all          Bind all registered targets
  clip unbind --all        Remove all native bindings
  clip binds               List currently bound targets
  clip <target> tools
  clip <target> --help

Global flags:
  --json        Output as JSON (unwraps MCP content, wraps CLI stdout)
  --pipe        Force buffered mode even in a TTY (disables passthrough)
  --dry-run     Print equivalent curl command instead of executing (API targets only)
  --help, -h    Show this help
  --version, -v Show version

Config:
  ~/.clip/target/{mcp,cli,api,grpc,graphql}/<name>/config.yml

Native bind PATH setup (add to shell profile):
  export PATH="${BIND_DIR}:$PATH"

OAuth tokens:
  ~/.clip/target/mcp/<name>/auth.json
  ~/.clip/target/api/<name>/auth.json
  ~/.clip/target/grpc/<name>/auth.json
  ~/.clip/target/graphql/<name>/auth.json

Examples:
  clip add gh gh --deny delete,apply
  clip add notion https://mcp.notion.com/mcp
  clip add linear https://mcp.linear.app/mcp
  clip add petstore https://petstore3.swagger.io/api/v3/openapi.json --api
  clip add grpcserver grpc.example.com:443 --grpc
  clip add localgrpc localhost:50051 --grpc --plaintext
  clip add gh https://api.github.com/graphql --graphql
  clip login notion      # OAuth 인증
  clip logout notion     # 토큰 삭제
  clip refresh petstore  # OpenAPI spec 재fetch
  clip refresh grpcserver  # gRPC schema 캐시 갱신
  clip refresh gh          # GraphQL schema 재fetch
  clip list
  clip notion tools
  clip petstore tools
  clip grpcserver tools
  clip grpcserver describe PetService.GetPet
  clip grpcserver PetService.GetPet --id 123
  clip gh tools
  clip gh types
  clip gh describe User
  clip gh viewer '{ login bio }'
  clip gh repository --owner foo --name bar --select name,stargazerCount
  clip --json gh pr list
  clip gh get pods -n default
  clip bind gh            # 이후 "gh pr list" 가 clip을 통해 실행됨
  clip unbind gh

Tree ACL (~/.clip/target/cli/gh/config.yml 직접 편집):
  command: gh
  acl:
    topic:
      allow: [describe, list]
    group:
      deny: [delete]

Agent integration:
  clip skills add claude-code

Zsh completion:
  eval "$(clip completion zsh)"   # Add to ~/.zshrc
  ZSH_AUTOSUGGEST_STRATEGY=(history completion)
`.trim();

// --- argv 수동 파싱 ---
// clip [글로벌 플래그...] <target> <subcommand> [...target-args]
// 글로벌 플래그는 앞에서만 소비하고, target 이름 이후는 전부 passthrough

function parseGlobalFlags(argv: string[]): {
  jsonMode: boolean;
  pipeMode: boolean;
  dryRun: boolean;
  configPath: string | undefined;
  rest: string[];
} {
  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  let i = 0;

  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--json") {
      jsonMode = true;
      i++;
    } else if (a === "--pipe") {
      pipeMode = true;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--version" || a === "-v") {
      console.log(`clip ${VERSION}`);
      process.exit(0);
    } else if ((a === "--config" || a === "-c") && argv[i + 1]) {
      configPath = argv[++i];
      i++;
    } else {
      break; // 첫 비플래그 인자 = target 이름
    }
  }

  return { jsonMode, pipeMode, dryRun, configPath, rest: argv.slice(i) };
}

// --- list / add / remove ---

function formatAcl(target: CliTarget | McpTarget | ApiTarget | GrpcTarget | GraphqlTarget): string {
  const parts: string[] = [];
  if (target.allow && target.allow.length > 0) parts.push(`allow: ${target.allow.join(",")}`);
  if (target.deny && target.deny.length > 0) parts.push(`deny: ${target.deny.join(",")}`);
  if (target.acl) {
    const keys = Object.keys(target.acl);
    parts.push(`acl: [${keys.join(",")}]`);
  }
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}

async function runList(): Promise<void> {
  const config = await loadConfig();
  const cliEntries = Object.entries(config.cli);
  const mcpEntries = Object.entries(config.mcp);
  const apiEntries = Object.entries(config.api);
  const grpcEntries = Object.entries(config.grpc);
  const graphqlEntries = Object.entries(config.graphql);

  if (cliEntries.length === 0 && mcpEntries.length === 0 && apiEntries.length === 0 && grpcEntries.length === 0 && graphqlEntries.length === 0) {
    console.log("No targets configured.");
    console.log(`\nAdd one:\n  clip add <name> <command>          # CLI tool`);
    console.log(`  clip add <name> <https://...>      # MCP server`);
    console.log(`  clip add <name> <https://.../openapi.json> --api  # OpenAPI REST API`);
    console.log(`  clip add <name> <host:port> --grpc  # gRPC server`);
    console.log(`  clip add <name> <https://.../graphql> --graphql  # GraphQL API`);
    return;
  }

  const bound = new Set(await listBound());

  console.log("Targets:");
  for (const [name, b] of [...cliEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const bindTag = bound.has(name) ? " [bind]" : "";
    const profileTag = b.active ? ` @${b.active}` : "";
    console.log(`  ${name.padEnd(16)} [cli]${bindTag} ${b.command}${profileTag}${formatAcl(b)}`);
  }
  for (const [name, b] of [...mcpEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const bindTag = bound.has(name) ? " [bind]" : "";
    if (b.transport === "stdio") {
      const profileTag = b.active ? ` @${b.active}` : "";
      console.log(`  ${name.padEnd(16)} [mcp]${bindTag} ${b.command}${profileTag}${formatAcl(b)}`);
    } else {
      const authStatus = await getAuthStatus(name);
      const statusTag = authStatus
        ? `  [${authStatus}]`
        : b.auth === "oauth"
          ? "  [not authenticated]"
          : b.auth === "apikey"
            ? "  [api key]"
            : "  [no auth]";
      const transportLabel = b.transport === "sse" ? "SSE: " : "";
      const profileTag = b.active ? ` @${b.active}` : "";
      console.log(`  ${name.padEnd(16)} [mcp]${bindTag} ${transportLabel}${b.url}${profileTag}${formatAcl(b)}${statusTag}`);
    }
  }
  for (const [name, b] of [...apiEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const bindTag = bound.has(name) ? " [bind]" : "";
    const authStatus = await getAuthStatus(name, "api");
    const statusTag = authStatus
      ? `  [${authStatus}]`
      : b.auth === "oauth"
        ? "  [not authenticated]"
        : b.auth === "apikey"
          ? "  [api key]"
          : "  [no auth]";
    const profileTagApi = b.active ? ` @${b.active}` : "";
    console.log(`  ${name.padEnd(16)} [api]${bindTag} ${b.baseUrl ?? b.openapiUrl ?? ""}${profileTagApi}${formatAcl(b)}${statusTag}`);
  }
  for (const [name, b] of [...grpcEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const bindTag = bound.has(name) ? " [bind]" : "";
    const authStatus = b.oauth ? await getAuthStatus(name, "grpc") : null;
    const statusTag = authStatus
      ? `  [${authStatus}]`
      : b.oauth
        ? "  [not authenticated]"
        : b.metadata?.["authorization"]
          ? "  [api key]"
          : "  [no auth]";
    const profileTagGrpc = b.active ? ` @${b.active}` : "";
    console.log(`  ${name.padEnd(16)} [grpc]${bindTag} ${b.address}${profileTagGrpc}${formatAcl(b)}${statusTag}`);
  }
  for (const [name, b] of [...graphqlEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const bindTag = bound.has(name) ? " [bind]" : "";
    const authStatus = b.oauth ? await getAuthStatus(name, "graphql") : null;
    const statusTag = authStatus
      ? `  [${authStatus}]`
      : b.oauth
        ? "  [not authenticated]"
        : b.headers?.["authorization"]
          ? "  [api key]"
          : "  [no auth]";
    const profileTagGql = b.active ? ` @${b.active}` : "";
    console.log(`  ${name.padEnd(16)} [gql]${bindTag} ${b.endpoint}${profileTagGql}${formatAcl(b)}${statusTag}`);
  }
}

async function runAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    die("Usage: clip add <name> <command-or-url> [--allow x,y] [--deny z]");
  }

  // 두 번째 positional (플래그가 아닌 것) 수집
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  // boolean 플래그: 다음 인자를 value로 소비하지 않음
  const BOOL_FLAGS = new Set(["stdio", "sse", "api", "grpc", "graphql", "plaintext"]);
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL_FLAGS.has(key)) {
        flags[key] = "true";
      } else {
        const val = args[i + 1] ?? "";
        if (val && !val.startsWith("--")) {
          flags[key] = val;
          i++;
        } else {
          flags[key] = "true";
        }
      }
    } else {
      positionals.push(a);
    }
  }

  const allow = flags["allow"] ? flags["allow"].split(",").map((s) => s.trim()) : undefined;
  const deny = flags["deny"] ? flags["deny"].split(",").map((s) => s.trim()) : undefined;

  // 타입 결정: --type 명시 > --grpc/--api/--stdio 명시 > positional 자동 감지
  let type = flags["type"] as "mcp" | "cli" | "api" | "grpc" | "graphql" | undefined;
  if (!type && flags["graphql"]) type = "graphql";
  if (!type && flags["grpc"]) type = "grpc";
  if (!type && flags["api"]) type = "api";
  if (!type && flags["url"]) type = "mcp";
  if (!type && flags["stdio"]) type = "mcp";
  if (!type && flags["sse"]) type = "mcp";
  if (!type && flags["command"]) type = "cli";
  if (!type && positionals[0]) {
    const url = positionals[0];
    const isUrl = url.startsWith("http://") || url.startsWith("https://");
    if (isUrl) {
      const lower = url.toLowerCase().split("?")[0]!.split("#")[0]!;
      const isApiSpec = /\/(openapi|swagger)\.(json|ya?ml)$/.test(lower) || /\/openapi\.json$/.test(lower);
      if (lower.endsWith("/graphql")) type = "graphql";
      else if (isApiSpec) type = "api";
      else type = "mcp";
    } else {
      type = "cli";
    }
  }
  if (!type) die("Cannot detect type. Provide <command-or-url> or --type mcp|cli|api|grpc|graphql");

  if (type === "graphql") {
    const endpoint = flags["endpoint"] ?? positionals[0];
    if (!endpoint) die("GraphQL target requires an endpoint URL (e.g. clip add gh https://api.github.com/graphql --graphql)");
    await addTarget(name, "graphql", { endpoint, allow, deny });
    console.log(`Added GraphQL target "${name}" → ${endpoint}`);
    return;
  }

  if (type === "grpc") {
    const address = flags["address"] ?? positionals[0];
    if (!address) die("gRPC target requires an address (e.g. clip add petstore grpc.example.com:443 --grpc)");
    const proto = flags["proto"] ?? undefined;
    const plaintext = flags["plaintext"] ? true : undefined;
    await addTarget(name, "grpc", {
      address,
      ...(proto ? { proto } : {}),
      ...(plaintext ? { plaintext } : {}),
      allow,
      deny,
    });
    console.log(`Added gRPC target "${name}" → ${address}`);
    return;
  }

  if (type === "api") {
    const baseUrl = flags["base-url"] ?? flags["baseUrl"] ?? positionals[0];
    if (!baseUrl) die("API target requires a base URL (e.g. clip add petstore https://api.example.com)");
    const openapiUrl = flags["openapi-url"] ?? flags["openapiUrl"];
    await addTarget(name, "api", { auth: false, baseUrl, ...(openapiUrl ? { openapiUrl } : {}), allow, deny });
    console.log(`Added API target "${name}" → ${baseUrl}`);
    // securitySchemes 힌트: best-effort fetch
    try {
      const resp = await fetch(openapiUrl ?? baseUrl);
      if (resp.ok) {
        const text = await resp.text();
        const spec = JSON.parse(text) as Record<string, unknown>;
        const components = spec["components"] as Record<string, unknown> | undefined;
        const schemes = Object.values(
          (components?.["securitySchemes"] as Record<string, unknown> | undefined) ??
          (spec["securityDefinitions"] as Record<string, unknown> | undefined) ??
          {},
        );
        if (schemes.length > 0) {
          const kinds = schemes.map((s) => (s as Record<string, string>)["type"] ?? (s as Record<string, string>)["scheme"]).join(", ");
          process.stderr.write(`clip: This API declares auth (${kinds}). Add 'auth: oauth' or 'auth: apikey' with 'headers:' in config.yml.\n`);
        }
      }
    } catch { /* silent */ }
    return;
  }

  if (type === "mcp") {
    if (flags["stdio"]) {
      // STDIO MCP: clip add <name> --stdio <cmd> [args...]
      const command = flags["command"] ?? positionals[0];
      if (!command) die("STDIO MCP target requires a command (e.g. clip add fs --stdio npx -y @modelcontextprotocol/server-filesystem /)");
      const prependArgs = flags["args"]
        ? flags["args"].split(",").map((s) => s.trim())
        : positionals.slice(1).length > 0 ? positionals.slice(1) : undefined;
      await addTarget(name, "mcp", { transport: "stdio", command, args: prependArgs, allow, deny });
      console.log(`Added STDIO MCP target "${name}" → ${command}${prependArgs ? " " + prependArgs.join(" ") : ""}`);
    } else if (flags["sse"]) {
      // SSE MCP: clip add <name> --sse <url>
      const url = flags["url"] ?? positionals[0];
      if (!url) die("SSE MCP target requires a URL (e.g. clip add myserver --sse https://example.com/sse)");
      await addTarget(name, "mcp", { transport: "sse", url, auth: false, allow, deny });
      console.log(`Added SSE MCP target "${name}" → ${url}`);
    } else {
      // HTTP MCP (Streamable HTTP)
      const url = flags["url"] ?? positionals[0];
      if (!url) die("MCP target requires a URL (e.g. clip add myserver https://...mcp)");
      await addTarget(name, "mcp", { transport: "http", url, auth: false, allow, deny });
      console.log(`Added MCP target "${name}" → ${url}`);
    }
  } else {
    const command = flags["command"] ?? positionals[0];
    if (!command) die("CLI target requires a command (e.g. clip add gh gh)");
    const prependArgs = flags["args"] ? flags["args"].split(",").map((s) => s.trim()) : undefined;
    await addTarget(name, "cli", { command, args: prependArgs, allow, deny });
    console.log(`Added CLI target "${name}" → ${command}`);
  }
}

async function runRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip remove <name>");
  await removeTarget(name);
  console.log(`Removed target "${name}".`);
}

async function runBind(args: string[]): Promise<void> {
  const flag = args[0];
  if (flag === "--all") {
    const config = await loadConfig();
    const names = [...Object.keys(config.cli), ...Object.keys(config.mcp), ...Object.keys(config.api), ...Object.keys(config.grpc), ...Object.keys(config.graphql)];
    if (names.length === 0) { console.log("No targets configured."); return; }
    for (const name of names) await bindTarget(name);
    return;
  }
  const name = flag;
  if (!name) die("Usage: clip bind <target> | clip bind --all");
  // target이 등록되어 있는지 확인
  const config = await loadConfig();
  getTarget(config, name); // 없으면 die
  await bindTarget(name);
}

async function runUnbind(args: string[]): Promise<void> {
  const flag = args[0];
  if (flag === "--all") {
    const names = await listBound();
    if (names.length === 0) { console.log("No bindings found."); return; }
    for (const name of names) await unbindTarget(name);
    return;
  }
  const name = flag;
  if (!name) die("Usage: clip unbind <target> | clip unbind --all");
  await unbindTarget(name);
}

async function runBinds(): Promise<void> {
  const names = await listBound();
  if (names.length === 0) {
    console.log("No native bindings.");
    console.log(`\nBind a target with: clip bind <target>`);
    return;
  }
  console.log("Bound targets:");
  for (const name of names) console.log(`  ${name}  (${BIND_DIR}/${name} → clip)`);
}

// --- config 서브커맨드 (하위 호환) ---

async function runConfigCmd(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "list") return runList();
  if (sub === "add") return runAdd(args.slice(1));
  if (sub === "remove") return runRemove(args.slice(1));
  die(`Unknown config subcommand: "${sub}"\nUsage: clip config list|add|remove`);
}

// --- target help ---

async function printTargetHelp(
  name: string,
  type: "cli" | "mcp" | "api" | "grpc" | "graphql",
  target: CliTarget | McpTarget | ApiTarget | GrpcTarget | GraphqlTarget,
): Promise<void> {
  let detail: string;
  if (type === "mcp") {
    const mcp = target as McpTarget;
    detail = mcp.transport === "stdio"
      ? `STDIO MCP: ${mcp.command}`
      : mcp.transport === "sse"
        ? `SSE MCP: ${mcp.url}`
        : `MCP server: ${mcp.url}`;
  } else if (type === "api") {
    detail = `API: ${(target as ApiTarget).baseUrl ?? (target as ApiTarget).openapiUrl ?? ""}`;
  } else if (type === "grpc") {
    detail = `gRPC: ${(target as GrpcTarget).address}`;
  } else if (type === "graphql") {
    detail = `GraphQL: ${(target as GraphqlTarget).endpoint}`;
  } else {
    detail = `CLI command: ${(target as CliTarget).command}`;
  }
  console.log(`clip ${name} — ${detail}`);
  console.log(`\nUsage: clip ${name} <subcommand> [...args]`);

  if (target.allow && target.allow.length > 0) {
    console.log(`\nAllowed: ${target.allow.join(", ")}`);
  }
  if (target.deny && target.deny.length > 0) {
    console.log(`Denied:  ${target.deny.join(", ")}`);
  }
  if (target.acl) {
    console.log("\nACL tree:");
    for (const [sub, node] of Object.entries(target.acl)) {
      const parts: string[] = [];
      if (node.allow?.length) parts.push(`allow: ${node.allow.join(", ")}`);
      if (node.deny?.length) parts.push(`deny: ${node.deny.join(", ")}`);
      console.log(`  ${sub}: ${parts.join("  ") || "(unrestricted)"}`);
    }
  }
  if (!target.allow?.length && !target.deny?.length && !target.acl) {
    console.log(`\nNo ACL restrictions.`);
  }

  if (type === "mcp" || type === "api" || type === "grpc" || type === "graphql") {
    console.log(`\nRun: clip ${name} tools  — to list available tools`);
  }
  if (type === "api") {
    console.log(`Run: clip refresh ${name}  — to re-fetch spec`);
  }
  if (type === "grpc") {
    console.log(`Run: clip ${name} describe  — to list services`);
    console.log(`Run: clip refresh ${name}  — to refresh schema cache`);
  }
  if (type === "graphql") {
    console.log(`Run: clip ${name} types    — to list schema types`);
    console.log(`Run: clip ${name} describe <TypeName>  — SDL-style type description`);
    console.log(`Run: clip refresh ${name}  — to re-fetch schema`);
  }

  if (type === "cli") {
    const cli = target as CliTarget;
    const proc = Bun.spawn([cli.command, ...(cli.args ?? []), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...(cli.env ?? {}) } as Record<string, string>,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    const helpText = (stdout || stderr).trim();
    if (helpText) {
      console.log(`\n--- ${cli.command} --help ---\n`);
      console.log(helpText);
    }
  }
}

// --- 메인 ---

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const { jsonMode, pipeMode, dryRun, rest } = parseGlobalFlags(argv);

  if (rest.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const targetName = rest[0]!;

  // 내장 명령
  if (targetName === "config") { await runConfigCmd(rest.slice(1)); return; }
  if (targetName === "list") { await runList(); return; }
  if (targetName === "add") { await runAdd(rest.slice(1)); return; }
  if (targetName === "remove") { await runRemove(rest.slice(1)); return; }
  if (targetName === "skills") { await runSkillsCmd(rest.slice(1)); return; }
  if (targetName === "bind") { await runBind(rest.slice(1)); return; }
  if (targetName === "unbind") { await runUnbind(rest.slice(1)); return; }
  if (targetName === "binds") { await runBinds(); return; }
  if (targetName === "completion") { await runCompletionCmd(rest.slice(1)); return; }
  if (targetName === "profile") { await runProfileCmd(rest.slice(1)); return; }

  if (targetName === "refresh") {
    const name = rest[1];
    if (!name) die("Usage: clip refresh <target>");
    const cfg = await loadConfig();
    const { type, target } = getTarget(cfg, name);
    if (type === "grpc") {
      const result = await executeGrpc(target as GrpcTarget, cfg.headers, "refresh", [], name);
      process.stdout.write(result.stdout);
      return;
    }
    if (type === "graphql") {
      const result = await executeGraphql(target as GraphqlTarget, cfg.headers, "refresh", [], name);
      process.stdout.write(result.stdout);
      return;
    }
    if (type !== "api") die(`"${name}" is not an API, gRPC, or GraphQL target. refresh only applies to those types.`);
    const result = await executeApi(target as ApiTarget, cfg.headers, "refresh", [], name, true);
    process.stdout.write(result.stdout);
    return;
  }

  if (targetName === "login") {
    const name = rest[1];
    if (!name) die("Usage: clip login <target>");
    const cfg = await loadConfig();
    const { type, target } = getTarget(cfg, name);
    if (type === "api") {
      const apiUrl = (target as ApiTarget).baseUrl;
      if (!apiUrl) die(`"${name}" has no baseUrl configured. OAuth requires a baseUrl.`);
      await forceLogin(name, apiUrl, "api");
      return;
    }
    if (type === "grpc") die(`"${name}" is a gRPC target. gRPC v1 doesn't support automatic OAuth.\nStore static bearer token in ~/.clip/target/grpc/${name}/auth.json\nor use 'metadata: {authorization: "Bearer <token>"}' in config.yml.`);
    if (type === "graphql") {
      await forceLogin(name, (target as GraphqlTarget).endpoint, "graphql");
      return;
    }
    if (type !== "mcp") die(`"${name}" is not an MCP, API, or GraphQL target. OAuth only applies to those types.`);
    const mcpForLogin = target as McpTarget;
    if (mcpForLogin.transport === "stdio") die(`"${name}" is a STDIO MCP target. OAuth only applies to HTTP/SSE MCP targets.`);
    await forceLogin(name, (mcpForLogin as McpHttpTarget | McpSseTarget).url);
    return;
  }

  if (targetName === "logout") {
    const name = rest[1];
    if (!name) die("Usage: clip logout <target>");
    const cfg = await loadConfig();
    const { type } = getTarget(cfg, name);
    if (type === "api") {
      await removeTokens(name, "api");
    } else if (type === "grpc") {
      await removeTokens(name, "grpc");
    } else if (type === "graphql") {
      await removeTokens(name, "graphql");
    } else {
      await removeTokens(name);
    }
    console.log(`Logged out of "${name}".`);
    return;
  }

  // <target>@<profile> 파싱
  const atIdx = targetName.indexOf("@");
  const baseName = atIdx >= 0 ? targetName.slice(0, atIdx) : targetName;
  const explicitProfile = atIdx >= 0 ? targetName.slice(atIdx + 1) : undefined;

  const config = await loadConfig();
  const resolved = getTarget(config, baseName);
  const { merged: mergedTarget } = resolveProfile(resolved.target, explicitProfile);
  const { type } = resolved;
  const target = mergedTarget;

  const subcommand = rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    await printTargetHelp(baseName, type, target);
    process.exit(0);
  }

  const rawTargetArgs = rest.slice(2);
  const LATE_FLAGS = new Set(["--dry-run", "--json", "--pipe"]);
  const effectiveDryRun = dryRun || rawTargetArgs.includes("--dry-run");
  const effectiveJsonMode = jsonMode || rawTargetArgs.includes("--json");
  const effectivePipeMode = pipeMode || rawTargetArgs.includes("--pipe");
  const effectivePassthrough = !!process.stdout.isTTY && !effectiveJsonMode && !effectivePipeMode;
  const targetArgs = rawTargetArgs.filter((a) => !LATE_FLAGS.has(a));

  // ACL 체크 제외: --help 플래그, 또는 내장 메타 명령
  // tools: 모든 타입에서 ACL 우회 (discovery 명령)
  // describe/types: graphql·grpc 전용 메타 명령에서만 ACL 스킵
  const hasHelpFlag = targetArgs.includes("--help") || targetArgs.includes("-h");
  const isBuiltinSubcommand =
    (subcommand === "tools" && type !== "cli") ||
    ((type === "graphql" || type === "grpc") && (subcommand === "describe" || subcommand === "types"));
  if (!isBuiltinSubcommand && !hasHelpFlag) {
    checkAcl(target, subcommand, targetArgs[0], targetName);
  }

  if (type === "graphql") {
    const result = await executeGraphql(target as GraphqlTarget, config.headers, subcommand, targetArgs, targetName);
    formatOutput(result, jsonMode ? "json" : "plain", "graphql");
  } else if (type === "grpc") {
    const result = await executeGrpc(target as GrpcTarget, config.headers, subcommand, targetArgs, targetName);
    formatOutput(result, effectiveJsonMode ? "json" : "plain", "grpc");
  } else if (type === "api") {
    const result = await executeApi(target as ApiTarget, config.headers, subcommand, targetArgs, targetName, false, effectiveDryRun);
    formatOutput(result, effectiveJsonMode ? "json" : "plain", "api");
  } else if (type === "mcp") {
    const mcpTarget = target as McpTarget;
    const result = mcpTarget.transport === "stdio"
      ? await executeMcpStdio(mcpTarget as McpStdioTarget, subcommand, targetArgs, targetName, effectiveDryRun)
      : mcpTarget.transport === "sse"
        ? await executeMcpSse(mcpTarget as McpSseTarget, config.headers, subcommand, targetArgs, targetName, effectiveDryRun)
        : await executeMcp(mcpTarget as McpHttpTarget, config.headers, subcommand, targetArgs, targetName, effectiveDryRun);
    formatOutput(result, effectiveJsonMode ? "json" : "plain", "mcp");
  } else {
    const result = await executeCli(target as CliTarget, subcommand, targetArgs, effectivePassthrough && !effectiveDryRun, effectiveDryRun);
    if (!effectivePassthrough || effectiveDryRun) formatOutput(result, effectiveJsonMode ? "json" : "plain", "cli");
    else process.exit(result.exitCode);
  }
}

main().catch((e: unknown) => {
  die(String(e));
});
