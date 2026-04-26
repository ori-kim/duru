import { getAuthStatus, resolveAuthDir } from "@clip/auth";
import { addTarget, die, subProfiles, subRecord, updateTarget } from "@clip/core";
import type { AddArgs, ClipExtension, ExecutorContext, ListOpts, NormalizeCtx, TargetResult } from "@clip/core";
import { executeMcp } from "./http.ts";
import {
  type McpHttpTarget,
  type McpSseTarget,
  type McpStdioTarget,
  type McpTarget,
  mcpTargetSchema,
} from "./schema.ts";
import { executeMcpSse } from "./sse.ts";
import { executeMcpStdio } from "./stdio.ts";
import { readToolsCache } from "./tools-cache.ts";

function executeMcpUnified(target: McpTarget, ctx: ExecutorContext): Promise<TargetResult> {
  if (target.transport === "stdio") return executeMcpStdio(target as McpStdioTarget, ctx);
  if (target.transport === "sse") return executeMcpSse(target as McpSseTarget, ctx);
  return executeMcp(target as McpHttpTarget, ctx);
}

function normalizeMcp(t: McpTarget, ctx: NormalizeCtx): McpTarget {
  if (t.transport === "stdio") return t;
  const http = t as McpHttpTarget | McpSseTarget;
  return {
    ...http,
    headers: subRecord(http.headers, ctx.env),
    profiles: subProfiles(http.profiles, ctx.env, ["headers"]),
  } as McpTarget;
}

export const extension: ClipExtension = {
  name: "builtin:mcp",
  init(api) {
    api.registerTargetType({
      type: "mcp",
      schema: mcpTargetSchema,
      executor: (target, ctx) => executeMcpUnified(target as McpTarget, ctx),
      describeTools: (_, { targetName }) => readToolsCache(targetName),
      normalizeConfig: (parsed, ctx) => normalizeMcp(parsed as McpTarget, ctx),
    });
    api.registerResultPresenter({
      type: "mcp",
      toViewModel(result, meta) {
        return { kind: "call-result", content: result, meta };
      },
    });
    api.registerContribution({
      type: "mcp",
      dispatchPriority: 50,
      argSpec: {
        booleanFlags: ["stdio", "sse"],
        valueFlags: ["url", "command", "args"],
        identifyFlags: ["stdio", "sse", "url"],
      },
      displayHint: { headerColor: "33" },
      listRenderer: async (name, target, opts: ListOpts) => {
        const t = target as McpTarget;
        const { color, bind } = opts;
        const nm = color("33", name.padEnd(16));
        const profileTag = (t as Record<string, unknown>).active ? ` @${(t as Record<string, unknown>).active}` : "";
        const aclStr = formatMcpAcl(t as Record<string, unknown>);
        if (t.transport === "stdio") {
          return `  ${nm} stdio: ${(t as McpStdioTarget).command}${profileTag}${aclStr}${bind(name)}`;
        }
        const http = t as McpHttpTarget | McpSseTarget;
        const authStatus = await getAuthStatus(resolveAuthDir(name, "mcp"));
        const auth = (t as Record<string, unknown>).auth;
        const statusTag = authStatus
          ? color("2", `  [${authStatus}]`)
          : auth === "oauth" ? color("2", "  [not authenticated]")
          : auth === "apikey" ? color("2", "  [api key]")
          : color("2", "  [no auth]");
        const transportLabel = t.transport === "sse" ? "sse: " : "";
        return `  ${nm} ${transportLabel}${http.url}${profileTag}${aclStr}${statusTag}${bind(name)}`;
      },
      urlHeuristic: (url) => {
        // graphql과 api 휴리스틱에 매칭되지 않는 http URL
        const lower = url.toLowerCase().split("?")[0]!.split("#")[0]!;
        if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
        const isApiSpec = /\/(openapi|swagger)\.(json|ya?ml)$/.test(lower) || /\/openapi\.json$/.test(lower);
        if (isApiSpec) return false;
        if (lower.endsWith("/graphql")) return false;
        return true;
      },
      addHandler: async (args: AddArgs) => {
        const { name, positionals, flags, allow, deny } = args;
        if (flags["stdio"]) {
          const command = flags["command"] ?? positionals[0];
          if (!command) die("STDIO MCP target requires a command (e.g. clip add fs --stdio npx -y @modelcontextprotocol/server-filesystem /)");
          const prependArgs = flags["args"]
            ? flags["args"].split(",").map((s) => s.trim())
            : positionals.slice(1).length > 0 ? positionals.slice(1) : undefined;
          await addTarget(name, "mcp", { transport: "stdio", command, args: prependArgs, allow, deny });
          console.log(`Added STDIO MCP target "${name}" → ${command}${prependArgs ? " " + prependArgs.join(" ") : ""}`);
        } else if (flags["sse"]) {
          const url = flags["url"] ?? positionals[0];
          if (!url) die("SSE MCP target requires a URL (e.g. clip add myserver --sse https://example.com/sse)");
          await addTarget(name, "mcp", { transport: "sse", url, auth: false, allow, deny });
          console.log(`Added SSE MCP target "${name}" → ${url}`);
        } else {
          const url = flags["url"] ?? positionals[0];
          if (!url) die("MCP target requires a URL (e.g. clip add myserver https://...mcp)");
          await addTarget(name, "mcp", { transport: "http", url, auth: false, allow, deny });
          console.log(`Added MCP target "${name}" → ${url}`);
        }
      },
      helpRenderer: async (_name, target) => {
        const t = target as McpTarget;
        if (t.transport === "stdio") return `STDIO MCP: ${(t as McpStdioTarget).command}`;
        if (t.transport === "sse") return `SSE MCP: ${(t as McpSseTarget).url}`;
        return `MCP server: ${(t as McpHttpTarget).url}`;
      },
      loginHandler: async (name, target) => {
        const { forceLogin } = await import("@clip/auth");
        const t = target as McpTarget;
        if (t.transport === "stdio") throw new Error(`"${name}" is a STDIO MCP target. OAuth only applies to HTTP/SSE MCP targets.`);
        const url = (t as McpHttpTarget | McpSseTarget).url;
        await forceLogin(name, url, resolveAuthDir(name, "mcp"));
        await updateTarget(name, (raw) => ({ ...raw, auth: "oauth" }));
      },
    });
  },
};

function formatMcpAcl(target: Record<string, unknown>): string {
  const allow = target["allow"] as string[] | undefined;
  const deny = target["deny"] as string[] | undefined;
  const acl = target["acl"] as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (allow && allow.length > 0) parts.push(`allow: ${allow.join(",")}`);
  if (deny && deny.length > 0) parts.push(`deny: ${deny.join(",")}`);
  if (acl) parts.push(`acl: [${Object.keys(acl).join(",")}]`);
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}
