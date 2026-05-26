type RequestBody = NonNullable<RequestInit["body"]>;

export type RawRequestArgs = {
  method: string;
  path: string;
  query: Record<string, string | readonly string[]>;
  headers: Record<string, string>;
  body?: RequestBody;
  contentType?: string;
};

const httpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

export function parseRequestArgs(argv: readonly string[]): RawRequestArgs {
  const [first, second, ...rest] = argv;
  const firstMethod = first?.toUpperCase();
  const method = firstMethod && httpMethods.has(firstMethod) ? firstMethod : "GET";
  const path = method === "GET" && firstMethod !== "GET" ? (first ?? "/") : (second ?? "/");
  const args = method === "GET" && firstMethod !== "GET" ? argv.slice(1) : rest;
  const query: Record<string, string | readonly string[]> = {};
  const headers: Record<string, string> = {};
  let body: RequestBody | undefined;
  let contentType: string | undefined;
  const formFields: Array<readonly [string, string]> = [];
  const multipartFields: Array<readonly [string, string]> = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;

    if (arg === "--header" || arg === "-H") {
      const header = args[++index];
      if (!header) throw new Error(`${arg} requires <name:value>`);
      setHeader(headers, header);
      continue;
    }

    if (arg.startsWith("--header=")) {
      setHeader(headers, arg.slice("--header=".length));
      continue;
    }

    if (arg === "--body") {
      body = requiredNext(args, ++index, "--body");
      contentType = "application/json";
      continue;
    }

    if (arg.startsWith("--body=")) {
      body = arg.slice("--body=".length);
      contentType = "application/json";
      continue;
    }

    if (arg === "--body-base64") {
      body = decodeBase64(requiredNext(args, ++index, "--body-base64"));
      contentType = "application/octet-stream";
      continue;
    }

    if (arg.startsWith("--body-base64=")) {
      body = decodeBase64(arg.slice("--body-base64=".length));
      contentType = "application/octet-stream";
      continue;
    }

    if (arg === "--input") {
      body = JSON.stringify(parseJsonObject(requiredNext(args, ++index, "--input"), "--input"));
      contentType = "application/json";
      continue;
    }

    if (arg.startsWith("--input=")) {
      body = JSON.stringify(parseJsonObject(arg.slice("--input=".length), "--input"));
      contentType = "application/json";
      continue;
    }

    if (arg === "--form") {
      formFields.push(parseKeyValue(requiredNext(args, ++index, "--form")));
      continue;
    }

    if (arg.startsWith("--form=")) {
      formFields.push(parseKeyValue(arg.slice("--form=".length)));
      continue;
    }

    if (arg === "--multipart") {
      multipartFields.push(parseKeyValue(requiredNext(args, ++index, "--multipart")));
      continue;
    }

    if (arg.startsWith("--multipart=")) {
      multipartFields.push(parseKeyValue(arg.slice("--multipart=".length)));
      continue;
    }

    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[index + 1]?.startsWith("--") || args[index + 1] === undefined ? "true" : args[++index];
      appendQuery(query, key, value ?? "");
    }

    if (arg.startsWith("{")) {
      body = arg;
      contentType = "application/json";
    }
  }

  if (formFields.length > 0) {
    const form = new URLSearchParams();
    for (const [key, value] of formFields) form.append(key, value);
    body = form;
    contentType = "application/x-www-form-urlencoded";
  }

  if (multipartFields.length > 0) {
    const form = new FormData();
    for (const [key, value] of multipartFields) form.append(key, value);
    body = form;
    contentType = undefined;
  }

  return { method, path, query, headers, ...(body ? { body } : {}), ...(contentType ? { contentType } : {}) };
}

export function buildUrl(baseUrl: string, path: string, query: RawRequestArgs["query"]): string {
  if (isAbsoluteHttpUrl(path)) throw new Error("Absolute api operation paths are not allowed");

  const url = new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) url.searchParams.append(key, item);
  }
  return url.toString();
}

export function isRawRequestStart(value: string): boolean {
  return httpMethods.has(value.toUpperCase()) || value.startsWith("/") || isAbsoluteHttpUrl(value);
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

function parseKeyValue(value: string): readonly [string, string] {
  const separator = value.indexOf("=");
  if (separator <= 0) throw new Error(`Invalid field: ${value}`);
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseJsonObject(value: string, option: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${option} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function appendQuery(query: Record<string, string | readonly string[]>, key: string, value: string): void {
  const current = query[key];
  if (current === undefined) {
    query[key] = value;
    return;
  }
  query[key] = Array.isArray(current) ? [...current, value] : [current, value];
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}
