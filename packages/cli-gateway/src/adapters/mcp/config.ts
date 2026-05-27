import { parseOptionalOAuthProviderConfig } from "../../auth";
import type { GatewayOAuthProviderConfig } from "../../auth";
import type { AddInput, GatewayAddResult } from "../../types";
import { discoverMcpOAuthProvider } from "./oauth-discovery";
import type { FetchLike } from "./request";

export type McpAdapterConfig = McpHttpAdapterConfig | McpSseAdapterConfig | McpStdioAdapterConfig;

export type McpHttpAdapterConfig = {
  transport?: "http";
  url: string;
  headers?: Record<string, string>;
  protocolVersion?: string;
  auth?: GatewayOAuthProviderConfig;
};

export type McpSseAdapterConfig = {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
  protocolVersion?: string;
  auth?: GatewayOAuthProviderConfig;
};

export type McpStdioAdapterConfig = {
  transport: "stdio";
  command: string;
  args?: readonly string[];
  env?: Record<string, string>;
  protocolVersion?: string;
};

export function detectMcpInput(input: AddInput): boolean {
  const value = input.argv[0];
  return Boolean(value && isAbsoluteHttpUrl(value) && /mcp/i.test(new URL(value).pathname));
}

export async function mcpConfigFromAddInput(
  input: AddInput,
): Promise<McpAdapterConfig | GatewayAddResult<McpAdapterConfig>> {
  const transport = stringOption(input.options?.transport) ?? "http";
  if (transport === "stdio") {
    assertNoHttpAuthMode(input);
    return stdioConfigFromAddInput(input);
  }
  if (transport === "sse") return withOAuthDiscovery(sseConfigFromAddInput(input), input);
  if (transport === "http") return withOAuthDiscovery(httpConfigFromAddInput(input), input);
  throw new Error(`Invalid mcp target config: unsupported transport "${transport}"`);
}

export function parseMcpConfig(value: unknown): McpAdapterConfig {
  if (!isRecord(value)) throw new Error("Invalid mcp target config: config must be an object");
  const transport = stringOption(value.transport) ?? "http";
  if (transport === "stdio") return parseMcpStdioConfig(value);
  if (transport === "sse") return parseMcpSseConfig(value);
  if (transport === "http") return parseMcpHttpConfig(value);
  throw new Error(`Invalid mcp target config: unsupported transport "${transport}"`);
}

export function mcpSummary(config: McpAdapterConfig): string {
  if (config.transport === "stdio") return `stdio: ${config.command}`;
  if (config.transport === "sse") return `sse: ${config.url}`;
  return config.url;
}

function httpConfigFromAddInput(input: AddInput): McpHttpAdapterConfig {
  const url = input.argv[0];
  if (!url) throw new Error("MCP target requires a url argument");
  return { url };
}

async function withOAuthDiscovery<TConfig extends McpHttpAdapterConfig | McpSseAdapterConfig>(
  config: TConfig,
  input: AddInput,
): Promise<TConfig | GatewayAddResult<TConfig>> {
  const auth = stringOption(input.options?.auth);
  if (!auth || auth === "none" || auth === "false") return config;
  if (auth !== "oauth") throw new Error(`Invalid mcp target auth: unsupported auth mode "${auth}"`);

  const provider = await discoverMcpOAuthProvider({
    url: config.url,
    fetch: gatewayFetch(input),
  });
  return {
    kind: "gateway.add-result",
    targetConfig: { ...config, auth: provider },
    sidecars: { oauth: provider },
  };
}

function gatewayFetch(input: AddInput): FetchLike | undefined {
  const candidate = input.context?.services?.fetch;
  return typeof candidate === "function" ? (candidate as FetchLike) : undefined;
}

function assertNoHttpAuthMode(input: AddInput): void {
  const auth = stringOption(input.options?.auth);
  if (auth && auth !== "none" && auth !== "false") {
    throw new Error("MCP stdio targets do not support OAuth discovery");
  }
}

function sseConfigFromAddInput(input: AddInput): McpSseAdapterConfig {
  const url = input.argv[0];
  if (!url) throw new Error("MCP SSE target requires a url argument");
  return { transport: "sse", url };
}

function stdioConfigFromAddInput(input: AddInput): McpStdioAdapterConfig {
  const command = input.argv[0];
  if (!command) throw new Error("MCP stdio target requires a command argument");
  return { transport: "stdio", command, args: input.argv.slice(1) };
}

function parseMcpHttpConfig(value: Record<string, unknown>): McpHttpAdapterConfig {
  const url = stringOption(value.url);
  if (!url) throw new Error("Invalid mcp target config: url is required");
  assertAbsoluteHttpUrl(url);
  return {
    transport: "http",
    url,
    ...sharedHttpConfig(value),
  };
}

function parseMcpSseConfig(value: Record<string, unknown>): McpSseAdapterConfig {
  const url = stringOption(value.url);
  if (!url) throw new Error("Invalid mcp target config: url is required");
  assertAbsoluteHttpUrl(url);
  return {
    transport: "sse",
    url,
    ...sharedHttpConfig(value),
  };
}

function parseMcpStdioConfig(value: Record<string, unknown>): McpStdioAdapterConfig {
  const command = stringOption(value.command);
  if (!command) throw new Error("Invalid mcp target config: command is required");
  if (value.args !== undefined && !isStringArray(value.args)) {
    throw new Error("Invalid mcp target config: args must be a string array");
  }
  if (value.env !== undefined && !isStringRecord(value.env)) {
    throw new Error("Invalid mcp target config: env must be a string record");
  }
  if (value.protocolVersion !== undefined && typeof value.protocolVersion !== "string") {
    throw new Error("Invalid mcp target config: protocolVersion must be a string");
  }
  return {
    transport: "stdio",
    command,
    ...(value.args ? { args: value.args } : {}),
    ...(value.env ? { env: value.env } : {}),
    ...(value.protocolVersion ? { protocolVersion: value.protocolVersion } : {}),
  };
}

function sharedHttpConfig(value: Record<string, unknown>) {
  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid mcp target config: headers must be a string record");
  }
  if (value.protocolVersion !== undefined && typeof value.protocolVersion !== "string") {
    throw new Error("Invalid mcp target config: protocolVersion must be a string");
  }
  const auth = value.auth === false ? undefined : parseOptionalOAuthProviderConfig(value.auth);
  return {
    ...(value.headers ? { headers: value.headers } : {}),
    ...(value.protocolVersion ? { protocolVersion: value.protocolVersion } : {}),
    ...(auth ? { auth } : {}),
  };
}

function assertAbsoluteHttpUrl(value: string): void {
  if (!isAbsoluteHttpUrl(value)) throw new Error("Invalid mcp target config: url must be an absolute URL");
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
