import { forceLogin, removeTokens } from "../commands/oauth.ts";
import type { ApiTarget, GraphqlTarget, McpHttpTarget, McpSseTarget, McpTarget } from "../config.ts";
import { getTarget, loadConfig } from "../config.ts";
import { die } from "../utils/errors.ts";

export async function runLogin(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip login <target>");
  const cfg = await loadConfig();
  const { type, target } = getTarget(cfg, name);
  if (type === "api") {
    const apiUrl = (target as ApiTarget).baseUrl;
    if (!apiUrl) die(`"${name}" has no baseUrl configured. OAuth requires a baseUrl.`);
    await forceLogin(name, apiUrl, "api");
    return;
  }
  if (type === "grpc")
    die(
      `"${name}" is a gRPC target. gRPC v1 doesn't support automatic OAuth.\nStore static bearer token in ~/.clip/target/grpc/${name}/auth.json\nor use 'metadata: {authorization: "Bearer <token>"}' in config.yml.`,
    );
  if (type === "graphql") {
    await forceLogin(name, (target as GraphqlTarget).endpoint, "graphql");
    return;
  }
  if (type !== "mcp") die(`"${name}" is not an MCP, API, or GraphQL target. OAuth only applies to those types.`);
  const mcpForLogin = target as McpTarget;
  if (mcpForLogin.transport === "stdio")
    die(`"${name}" is a STDIO MCP target. OAuth only applies to HTTP/SSE MCP targets.`);
  await forceLogin(name, (mcpForLogin as McpHttpTarget | McpSseTarget).url);
}

export async function runLogout(args: string[]): Promise<void> {
  const name = args[0];
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
}
