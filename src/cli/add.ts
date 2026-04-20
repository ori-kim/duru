import { addTarget } from "../config.ts";
import { die } from "../utils/errors.ts";

const RESERVED_NAMES = new Set([
  "config", "list", "add", "remove", "skills", "bind", "unbind", "binds",
  "completion", "profile", "alias", "refresh", "workspace", "login", "logout",
]);

export async function runAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    die("Usage: clip add <name> <command-or-url> [--allow x,y] [--deny z]");
  }
  if (RESERVED_NAMES.has(name)) {
    die(`"${name}" is a reserved command name and cannot be used as a target.`);
  }

  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const BOOL_FLAGS = new Set(["stdio", "sse", "api", "grpc", "graphql", "plaintext", "script", "global"]);
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (BOOL_FLAGS.has(key)) {
        flags[key] = "true";
      } else {
        const val = args[i + 1];
        if (val !== undefined && !val.startsWith("--")) {
          flags[key] = val;
          i++;
        } else {
          die(`--${key} requires a value`);
        }
      }
    } else {
      positionals.push(a);
    }
  }

  const allow = flags["allow"] ? flags["allow"].split(",").map((s) => s.trim()) : undefined;
  const deny = flags["deny"] ? flags["deny"].split(",").map((s) => s.trim()) : undefined;
  const addOpts = flags["global"] ? { global: true } : undefined;

  let type = flags["type"] as "mcp" | "cli" | "api" | "grpc" | "graphql" | "script" | undefined;
  if (!type && flags["graphql"]) type = "graphql";
  if (!type && flags["grpc"]) type = "grpc";
  if (!type && flags["api"]) type = "api";
  if (!type && flags["script"]) type = "script";
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
  if (!type) die("Cannot detect type. Provide <command-or-url> or --type mcp|cli|api|grpc|graphql|script");

  if (type === "script") {
    const description = flags["description"];
    await addTarget(name, "script", {
      ...(description ? { description } : {}),
      commands: {},
      allow,
      deny,
    }, addOpts);
    console.log(`Added script target "${name}".`);
    return;
  }

  if (type === "graphql") {
    const endpoint = flags["endpoint"] ?? positionals[0];
    if (!endpoint)
      die("GraphQL target requires an endpoint URL (e.g. clip add gh https://api.github.com/graphql --graphql)");
    await addTarget(name, "graphql", { endpoint, allow, deny }, addOpts);
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
    }, addOpts);
    console.log(`Added gRPC target "${name}" → ${address}`);
    return;
  }

  if (type === "api") {
    const baseUrl = flags["base-url"] ?? flags["baseUrl"] ?? positionals[0];
    if (!baseUrl) die("API target requires a base URL (e.g. clip add petstore https://api.example.com)");
    const openapiUrl = flags["openapi-url"] ?? flags["openapiUrl"];
    await addTarget(name, "api", { auth: false, baseUrl, ...(openapiUrl ? { openapiUrl } : {}), allow, deny }, addOpts);
    console.log(`Added API target "${name}" → ${baseUrl}`);
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
          const kinds = schemes
            .map((s) => (s as Record<string, string>)["type"] ?? (s as Record<string, string>)["scheme"])
            .join(", ");
          process.stderr.write(
            `clip: This API declares auth (${kinds}). Add 'auth: oauth' or 'auth: apikey' with 'headers:' in config.yml.\n`,
          );
        }
      }
    } catch {
      /* silent */
    }
    return;
  }

  if (type === "mcp") {
    if (flags["stdio"]) {
      const command = flags["command"] ?? positionals[0];
      if (!command)
        die(
          "STDIO MCP target requires a command (e.g. clip add fs --stdio npx -y @modelcontextprotocol/server-filesystem /)",
        );
      const prependArgs = flags["args"]
        ? flags["args"].split(",").map((s) => s.trim())
        : positionals.slice(1).length > 0
          ? positionals.slice(1)
          : undefined;
      await addTarget(name, "mcp", { transport: "stdio", command, args: prependArgs, allow, deny }, addOpts);
      console.log(`Added STDIO MCP target "${name}" → ${command}${prependArgs ? " " + prependArgs.join(" ") : ""}`);
    } else if (flags["sse"]) {
      const url = flags["url"] ?? positionals[0];
      if (!url) die("SSE MCP target requires a URL (e.g. clip add myserver --sse https://example.com/sse)");
      await addTarget(name, "mcp", { transport: "sse", url, auth: false, allow, deny }, addOpts);
      console.log(`Added SSE MCP target "${name}" → ${url}`);
    } else {
      const url = flags["url"] ?? positionals[0];
      if (!url) die("MCP target requires a URL (e.g. clip add myserver https://...mcp)");
      await addTarget(name, "mcp", { transport: "http", url, auth: false, allow, deny }, addOpts);
      console.log(`Added MCP target "${name}" → ${url}`);
    }
  } else {
    const command = flags["command"] ?? positionals[0];
    if (!command) die("CLI target requires a command (e.g. clip add gh gh)");
    const prependArgs = flags["args"] ? flags["args"].split(",").map((s) => s.trim()) : undefined;
    await addTarget(name, "cli", { command, args: prependArgs, allow, deny }, addOpts);
    console.log(`Added CLI target "${name}" → ${command}`);
  }
}
