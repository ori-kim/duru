import { type HasAliases, listAliases } from "../commands/alias.ts";
import { BIND_DIR } from "../commands/bind.ts";
import type { ApiTarget, CliTarget, GraphqlTarget, GrpcTarget, McpTarget, ScriptTarget } from "../config.ts";

export const VERSION = "0.6.4";

export const HELP = `
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
  clip alias add <target> <name> --subcommand <tool> [--arg X ...] [--input-json '{...}'] [--description "..."]
  clip alias remove <target> <name>
  clip alias list <target>
  clip alias show <target> <name>
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
  ~/.clip/target/{mcp,cli,api,grpc,graphql,script}/<name>/config.yml

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
  clip alias add slack send-me --subcommand chat.postMessage --input-json '{"channel":"U123","text":"$1"}' --description "Send DM to me"
  clip slack send-me "hello"
  clip alias add gh pods-dev --subcommand get --arg pods --arg -n --arg dev
  clip gh pods-dev
  # script target — bash/file 조합 명령
  clip lag lag my-group    # ~/.clip/target/script/lag/ 에 정의된 스크립트 실행

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

export async function printTargetHelp(
  name: string,
  type: "cli" | "mcp" | "api" | "grpc" | "graphql" | "script",
  target: CliTarget | McpTarget | ApiTarget | GrpcTarget | GraphqlTarget | ScriptTarget,
): Promise<void> {
  let detail: string;
  if (type === "mcp") {
    const mcp = target as McpTarget;
    detail =
      mcp.transport === "stdio"
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
  } else if (type === "script") {
    const st = target as ScriptTarget;
    const cmdCount = Object.keys(st.commands ?? {}).length;
    detail = st.description ? `Script: ${st.description}` : `Script target (${cmdCount} commands)`;
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

  const aliasList = listAliases(target as HasAliases);
  if (aliasList.length > 0) {
    console.log("\nAliases:");
    for (const s of aliasList) {
      const aliasDetail = s.input ? JSON.stringify(s.input) : s.args?.length ? s.args.join(" ") : "(pass-through)";
      const desc = s.description ? `  — ${s.description}` : "";
      console.log(`  ${s.name.padEnd(20)} → ${s.subcommand}  ${aliasDetail}${desc}`);
    }
  }

  if (type === "mcp" || type === "api" || type === "grpc" || type === "graphql" || type === "script") {
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
