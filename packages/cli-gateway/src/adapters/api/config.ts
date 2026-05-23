import type { AddInput } from "../../types";

export type ApiAdapterConfig = {
  baseUrl?: string;
  openapiUrl?: string;
  spec?: unknown;
  headers?: Record<string, string>;
};

export function detectApiInput(input: AddInput): boolean {
  const value = input.argv[0];
  return Boolean(value && isAbsoluteHttpUrl(value) && !looksLikeGraphqlUrl(value) && !looksLikeMcpUrl(value));
}

export function apiConfigFromAddInput(input: AddInput): ApiAdapterConfig {
  const parsed = parseAddArgs(input.argv);
  const firstValue = parsed.values[0];
  const openapiUrl = parsed.openapiUrl ?? (firstValue && looksLikeOpenApiSpecUrl(firstValue) ? firstValue : undefined);
  const baseUrl = parsed.baseUrl ?? (firstValue && firstValue !== openapiUrl ? firstValue : undefined);

  if (!baseUrl && !openapiUrl) {
    throw new Error("API target requires a baseUrl or openapiUrl argument");
  }

  return parseApiConfig({
    ...(baseUrl ? { baseUrl } : {}),
    ...(openapiUrl ? { openapiUrl } : {}),
    ...(Object.keys(parsed.headers).length > 0 ? { headers: parsed.headers } : {}),
  });
}

export function parseApiConfig(value: unknown): ApiAdapterConfig {
  if (!isRecord(value)) {
    throw new Error("Invalid api target config: baseUrl, openapiUrl, or spec is required");
  }

  const baseUrl = stringValue(value.baseUrl) ?? stringValue(value.url);
  const openapiUrl = stringValue(value.openapiUrl);
  const hasSpec = value.spec !== undefined;

  if (!baseUrl && !openapiUrl && !hasSpec) {
    throw new Error("Invalid api target config: baseUrl, openapiUrl, or spec is required");
  }

  if (baseUrl && !isAbsoluteHttpUrl(baseUrl)) {
    throw new Error("Invalid api target config: baseUrl must be an absolute URL");
  }

  if (openapiUrl && !isAbsoluteHttpUrl(openapiUrl)) {
    throw new Error("Invalid api target config: openapiUrl must be an absolute URL");
  }

  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid api target config: headers must be a string record");
  }

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(openapiUrl ? { openapiUrl } : {}),
    ...(hasSpec ? { spec: value.spec } : {}),
    ...(value.headers ? { headers: value.headers } : {}),
  };
}

function parseAddArgs(argv: readonly string[]): {
  values: readonly string[];
  baseUrl?: string;
  openapiUrl?: string;
  headers: Record<string, string>;
} {
  const values: string[] = [];
  const headers: Record<string, string> = {};
  let baseUrl: string | undefined;
  let openapiUrl: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--base-url") {
      baseUrl = requiredNext(argv, ++index, "--base-url");
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg === "--openapi-url") {
      openapiUrl = requiredNext(argv, ++index, "--openapi-url");
      continue;
    }

    if (arg.startsWith("--openapi-url=")) {
      openapiUrl = arg.slice("--openapi-url=".length);
      continue;
    }

    if (arg === "--header" || arg === "-H") {
      setHeader(headers, requiredNext(argv, ++index, arg));
      continue;
    }

    if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
      continue;
    }

    values.push(arg);
  }

  return { values, ...(baseUrl ? { baseUrl } : {}), ...(openapiUrl ? { openapiUrl } : {}), headers };
}

function setHeader(headers: Record<string, string>, value: string): void {
  const separator = value.indexOf(":");
  if (separator <= 0) throw new Error(`Invalid header: ${value}`);
  headers[value.slice(0, separator).trim()] = value.slice(separator + 1).trim();
}

function requiredNext(argv: readonly string[], index: number, option: string): string {
  const value = argv[index];
  if (value === undefined) throw new Error(`${option} requires a value`);
  return value;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function looksLikeOpenApiSpecUrl(value: string): boolean {
  if (!isAbsoluteHttpUrl(value)) return false;
  const path = new URL(value).pathname;
  return /(openapi|swagger|\.json$|\.ya?ml$)/i.test(path);
}

function looksLikeGraphqlUrl(value: string): boolean {
  return /graphql/i.test(new URL(value).pathname);
}

function looksLikeMcpUrl(value: string): boolean {
  return /mcp/i.test(new URL(value).pathname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
