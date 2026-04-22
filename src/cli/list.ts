import { listBound } from "../commands/bind.ts";
import { getAuthStatus } from "../commands/oauth.ts";
import { getActiveWorkspace, loadConfig } from "../config.ts";

export function formatAcl(
  target: Record<string, unknown>,
): string {
  const allow = target["allow"] as string[] | undefined;
  const deny = target["deny"] as string[] | undefined;
  const acl = target["acl"] as Record<string, unknown> | undefined;
  const parts: string[] = [];
  if (allow && allow.length > 0) parts.push(`allow: ${allow.join(",")}`);
  if (deny && deny.length > 0) parts.push(`deny: ${deny.join(",")}`);
  if (acl) {
    const keys = Object.keys(acl);
    parts.push(`acl: [${keys.join(",")}]`);
  }
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}

export async function runList(): Promise<void> {
  const config = await loadConfig();
  const cliEntries = Object.entries((config.targets["cli"] ?? {}) as Record<string, Record<string, unknown>>);
  const mcpEntries = Object.entries((config.targets["mcp"] ?? {}) as Record<string, Record<string, unknown>>);
  const apiEntries = Object.entries((config.targets["api"] ?? {}) as Record<string, Record<string, unknown>>);
  const grpcEntries = Object.entries((config.targets["grpc"] ?? {}) as Record<string, Record<string, unknown>>);
  const graphqlEntries = Object.entries((config.targets["graphql"] ?? {}) as Record<string, Record<string, unknown>>);
  const scriptEntries = Object.entries((config.targets["script"] ?? {}) as Record<string, Record<string, unknown>>);
  const extEntries = Object.entries(config._ext ?? {}).filter(([, m]) => Object.keys(m).length > 0);

  if (
    cliEntries.length === 0 &&
    mcpEntries.length === 0 &&
    apiEntries.length === 0 &&
    grpcEntries.length === 0 &&
    graphqlEntries.length === 0 &&
    scriptEntries.length === 0 &&
    extEntries.length === 0
  ) {
    console.log("No targets configured.");
    console.log(`\nAdd one:\n  clip add <name> <command>          # CLI tool`);
    console.log(`  clip add <name> <https://...>      # MCP server`);
    console.log(`  clip add <name> <https://.../openapi.json> --api  # OpenAPI REST API`);
    console.log(`  clip add <name> <host:port> --grpc  # gRPC server`);
    console.log(`  clip add <name> <https://.../graphql> --graphql  # GraphQL API`);
    return;
  }

  const bound = new Set(await listBound());
  const activeWs = getActiveWorkspace();
  const tty = process.stdout.isTTY;
  const c = (code: string, text: string) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
  const wsTag = (name: string) => {
    if (!activeWs) return "";
    const src = config._sources?.[name];
    return src !== undefined ? c("2", src ? ` [${src}]` : " [global]") : "";
  };

  const COLORS = {
    cli: "32",
    mcp: "33",
    api: "36",
    grpc: "1;34",
    graphql: "38;5;205",
    script: "38;5;245",
  } as const;
  type GroupKey = keyof typeof COLORS;

  let first = true;
  const printHeader = (key: GroupKey) => {
    if (!first) console.log();
    first = false;
    console.log(c(COLORS[key], `── ${key} ──`));
  };
  const nm = (key: GroupKey, name: string) => c(COLORS[key], name.padEnd(16));
  const bind = (name: string) => (bound.has(name) ? c("2", " [bind]") : "");

  if (cliEntries.length > 0) {
    printHeader("cli");
    for (const [name, b] of [...cliEntries].sort(([a], [b]) => a.localeCompare(b))) {
      const profileTag = b["active"] ? ` @${b["active"]}` : "";
      console.log(`  ${nm("cli", name)} ${b["command"]}${profileTag}${formatAcl(b)}${bind(name)}${wsTag(name)}`);
    }
  }

  if (mcpEntries.length > 0) {
    printHeader("mcp");
    for (const [name, b] of [...mcpEntries].sort(([a], [b]) => a.localeCompare(b))) {
      if (b["transport"] === "stdio") {
        const profileTag = b["active"] ? ` @${b["active"]}` : "";
        console.log(`  ${nm("mcp", name)} stdio: ${b["command"]}${profileTag}${formatAcl(b)}${bind(name)}${wsTag(name)}`);
      } else {
        const authStatus = await getAuthStatus(name);
        const auth = b["auth"];
        const statusTag = authStatus
          ? c("2", `  [${authStatus}]`)
          : auth === "oauth"
            ? c("2", "  [not authenticated]")
            : auth === "apikey"
              ? c("2", "  [api key]")
              : c("2", "  [no auth]");
        const transportLabel = b["transport"] === "sse" ? "sse: " : "";
        const profileTag = b["active"] ? ` @${b["active"]}` : "";
        console.log(
          `  ${nm("mcp", name)} ${transportLabel}${b["url"]}${profileTag}${formatAcl(b)}${statusTag}${bind(name)}${wsTag(name)}`,
        );
      }
    }
  }

  if (apiEntries.length > 0) {
    printHeader("api");
    for (const [name, b] of [...apiEntries].sort(([a], [b]) => a.localeCompare(b))) {
      const authStatus = await getAuthStatus(name, "api");
      const auth = b["auth"];
      const statusTag = authStatus
        ? c("2", `  [${authStatus}]`)
        : auth === "oauth"
          ? c("2", "  [not authenticated]")
          : auth === "apikey"
            ? c("2", "  [api key]")
            : c("2", "  [no auth]");
      const profileTag = b["active"] ? ` @${b["active"]}` : "";
      const url = (b["baseUrl"] ?? b["openapiUrl"] ?? "") as string;
      console.log(
        `  ${nm("api", name)} ${url}${profileTag}${formatAcl(b)}${statusTag}${bind(name)}${wsTag(name)}`,
      );
    }
  }

  if (grpcEntries.length > 0) {
    printHeader("grpc");
    for (const [name, b] of [...grpcEntries].sort(([a], [b]) => a.localeCompare(b))) {
      const authStatus = b["oauth"] ? await getAuthStatus(name, "grpc") : null;
      const metadata = b["metadata"] as Record<string, string> | undefined;
      const statusTag = authStatus
        ? c("2", `  [${authStatus}]`)
        : b["oauth"]
          ? c("2", "  [not authenticated]")
          : metadata?.["authorization"]
            ? c("2", "  [api key]")
            : c("2", "  [no auth]");
      const profileTag = b["active"] ? ` @${b["active"]}` : "";
      console.log(`  ${nm("grpc", name)} ${b["address"]}${profileTag}${formatAcl(b)}${statusTag}${bind(name)}${wsTag(name)}`);
    }
  }

  if (graphqlEntries.length > 0) {
    printHeader("graphql");
    for (const [name, b] of [...graphqlEntries].sort(([a], [b]) => a.localeCompare(b))) {
      const authStatus = b["oauth"] ? await getAuthStatus(name, "graphql") : null;
      const headers = b["headers"] as Record<string, string> | undefined;
      const statusTag = authStatus
        ? c("2", `  [${authStatus}]`)
        : b["oauth"]
          ? c("2", "  [not authenticated]")
          : headers?.["authorization"]
            ? c("2", "  [api key]")
            : c("2", "  [no auth]");
      const profileTag = b["active"] ? ` @${b["active"]}` : "";
      console.log(`  ${nm("graphql", name)} ${b["endpoint"]}${profileTag}${formatAcl(b)}${statusTag}${bind(name)}${wsTag(name)}`);
    }
  }

  if (scriptEntries.length > 0) {
    printHeader("script");
    for (const [name, b] of [...scriptEntries].sort(([a], [b]) => a.localeCompare(b))) {
      const commands = b["commands"] as Record<string, unknown> | undefined;
      const cmdCount = Object.keys(commands ?? {}).length;
      const desc = b["description"] ? ` — ${b["description"]}` : "";
      console.log(`  ${nm("script", name)} ${cmdCount} command(s)${desc}${formatAcl(b)}${bind(name)}${wsTag(name)}`);
    }
  }

  for (const [extType, targets] of extEntries) {
    if (!first) console.log();
    first = false;
    console.log(c("35", `── ${extType} ──`));
    for (const [name, cfg] of Object.entries(targets).sort(([a], [b]) => a.localeCompare(b))) {
      const desc =
        typeof cfg === "object" && cfg !== null && "description" in cfg ? ` — ${(cfg as { description: string }).description}` : "";
      console.log(`  ${c("35", name.padEnd(16))}${desc}${bind(name)}`);
    }
  }
}
