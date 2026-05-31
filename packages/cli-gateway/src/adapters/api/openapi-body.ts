import type { OpenApiTool } from "./openapi-parser";

type RequestBody = NonNullable<RequestInit["body"]>;

export type OperationArgs = {
  params: Record<string, unknown>;
  headers: Record<string, string>;
  body?: string;
  bodyBase64?: string;
};

export type OperationBody = {
  body: RequestBody;
  contentType?: string;
};

export function operationBody(tool: OpenApiTool, args: OperationArgs): OperationBody | undefined {
  const contentType = normalizedContentType(tool.bodyContentType);
  if (args.bodyBase64 !== undefined) {
    return {
      body: decodeBase64(args.bodyBase64),
      contentType: contentType ?? "application/octet-stream",
    };
  }

  if (args.body !== undefined) {
    return {
      body: args.body,
      ...(contentType ? { contentType } : { contentType: "application/json" }),
    };
  }

  if (!methodSupportsBody(tool.method)) return undefined;

  const bodyParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args.params)) {
    if (tool.pathParams.includes(key) || tool.queryParams.includes(key) || tool.headerParams.includes(key)) continue;
    bodyParams[key] = value;
  }

  if (Object.keys(bodyParams).length === 0) return undefined;
  if (Object.keys(bodyParams).length === 1 && bodyParams.body !== undefined) {
    const body = typeof bodyParams.body === "string" ? bodyParams.body : JSON.stringify(bodyParams.body);
    return { body, ...(contentType ? { contentType } : { contentType: "application/json" }) };
  }
  if (contentType === "application/x-www-form-urlencoded") {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(bodyParams)) appendFormValue(form, key, value);
    return { body: form, contentType };
  }
  if (contentType === "multipart/form-data") {
    const form = new FormData();
    for (const [key, value] of Object.entries(bodyParams)) appendMultipartValue(form, key, value);
    return { body: form };
  }
  return { body: JSON.stringify(bodyParams), ...(contentType ? { contentType } : { contentType: "application/json" }) };
}

export function defaultJsonContentType(tool: OpenApiTool): boolean {
  return !tool.bodyContentType || normalizedContentType(tool.bodyContentType) === "application/json";
}

function normalizedContentType(value: string | undefined): string | undefined {
  return value?.split(";")[0]?.trim().toLowerCase();
}

function appendFormValue(form: URLSearchParams, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) form.append(key, bodyValue(item));
    return;
  }
  form.append(key, bodyValue(value));
}

function appendMultipartValue(form: FormData, key: string, value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) appendMultipartValue(form, key, item);
    return;
  }
  if (value instanceof Blob) {
    form.append(key, value);
    return;
  }
  appendMultipartField(form, key, bodyValue(value));
}

export function appendMultipartField(form: FormData, key: string, value: string): void {
  if (value.startsWith("@")) {
    const path = value.slice(1);
    form.append(key, Bun.file(path), path.split("/").pop() || path);
    return;
  }
  form.append(key, value);
}

function bodyValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function methodSupportsBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "base64"));
}
