import { basename, join } from "node:path";
import { AuthenticatedClient, resolveAuthDir } from "@clip/auth";
import {
  CONFIG_DIR,
  ClipError,
  buildAliasSection,
  die,
  findTargetConfigDir,
  formatToolHelp,
  parseToolArgs,
  resolveTargetTimeoutMs,
  withTargetTimeoutSignal,
} from "@clip/core";
import type { ExecutorContext, TargetResult, Tool } from "@clip/core";
import YAML from "yaml";
import { parseOpenApi } from "./openapi.ts";
import type { ApiTool, MultipartField } from "./openapi.ts";
import type { ApiTarget } from "./schema.ts";

export type MultipartPart = {
  name: string;
  value: string;
  filePath?: string;
};

type ApiRequestBody = string | URLSearchParams | FormData | undefined;

function specCachePath(targetName: string): string {
  const dir = findTargetConfigDir(targetName, "api") ?? join(CONFIG_DIR, "target", "api", targetName);
  return join(dir, "spec.json");
}

async function loadSpec(
  targetName: string,
  target: ApiTarget,
  forceRefresh = false,
  timeoutMs = resolveTargetTimeoutMs(target),
): Promise<unknown> {
  const specUrl = target.openapiUrl;
  const cachePath = specCachePath(targetName);
  const cacheFile = Bun.file(cachePath);

  if (!specUrl) {
    if (!(await cacheFile.exists())) {
      die(
        `No spec URL configured for "${targetName}" and no local spec found.\n` +
          `Place your OpenAPI spec at: ${cachePath}`,
      );
    }
    try {
      return JSON.parse(await cacheFile.text());
    } catch {
      die(`Failed to parse spec at ${cachePath}`);
    }
  }

  if (!forceRefresh && (await cacheFile.exists())) {
    try {
      return JSON.parse(await cacheFile.text());
    } catch {
      // 손상된 캐시 → 재fetch
    }
  }

  const { resp, text } = await withTargetTimeoutSignal(timeoutMs, `OpenAPI spec ${targetName}`, async (signal) => {
    const resp =
      target.auth === "oauth"
        ? await new AuthenticatedClient({
            targetName,
            targetType: "api",
            serverUrl: specUrl,
            oauthEnabled: true,
            configDir: resolveAuthDir(targetName, "api"),
          }).fetch(specUrl, { signal })
        : await fetch(specUrl, { signal });
    return { resp, text: await resp.text() };
  }).catch((e: unknown) => {
    if (e instanceof ClipError) throw e;
    die(`Failed to fetch OpenAPI spec from ${specUrl}: ${e}`);
  });
  if (!resp.ok) {
    die(`Failed to fetch OpenAPI spec: HTTP ${resp.status} from ${specUrl}`);
  }

  let parsed: unknown;

  const ct = resp.headers.get("Content-Type") ?? "";
  const isYaml = ct.includes("yaml") || ct.includes("yml") || /\.(ya?ml)(\?|#|$)/i.test(specUrl);
  try {
    parsed = isYaml ? YAML.parse(text) : JSON.parse(text);
  } catch {
    // fallback: try both
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = YAML.parse(text);
    }
  }

  const dir = findTargetConfigDir(targetName, "api") ?? join(CONFIG_DIR, "target", "api", targetName);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(cachePath, JSON.stringify(parsed, null, 2));

  return parsed;
}

const sq = (s: string) => s.replace(/'/g, "'\\''");

function getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
  const lowerName = name.toLowerCase();
  let value: string | undefined;
  for (const [key, headerValue] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) value = headerValue;
  }
  return value;
}

function setHeaderValue(headers: Record<string, string>, name: string, value: string): void {
  const lowerName = name.toLowerCase();
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === lowerName);
  if (existingKey && existingKey !== name) delete headers[existingKey];
  headers[name] = value;
}

function deleteHeaderValue(headers: Record<string, string>, name: string): void {
  const lowerName = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lowerName) delete headers[key];
  }
}

function mergeHeadersCaseInsensitive(...sources: Array<Record<string, string> | undefined>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      setHeaderValue(merged, key, value);
    }
  }
  return merged;
}

export function buildInjectedHeaderArgs(
  headerParams: string[],
  headers: Record<string, string>,
): Record<string, unknown> {
  const injected: Record<string, unknown> = {};
  for (const param of headerParams) {
    const value = getHeaderValue(headers, param);
    if (value !== undefined) injected[param] = value;
  }
  return injected;
}

export function buildCurlCommand(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: ApiRequestBody,
  multipartParts: MultipartPart[] = [],
): string {
  const parts = [`curl -X ${method.toUpperCase()} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${sq(k)}: ${sq(v)}'`);
  }
  if (multipartParts.length > 0) {
    for (const part of multipartParts) {
      const value = part.filePath ? `${part.name}=@${part.filePath}` : `${part.name}=${part.value}`;
      parts.push(`  -F '${sq(value)}'`);
    }
  } else if (body instanceof URLSearchParams) {
    // URLSearchParams.toString() is already URL-encoded; --data-urlencode would double-encode
    parts.push(`  --data-raw '${body.toString()}'`);
  } else if (body) {
    parts.push(`  -d '${sq(body)}'`);
  }
  return `${parts.join(" \\\n")}\n`;
}

function isMultipartContentType(contentType: string | undefined): boolean {
  return !!contentType?.includes("multipart/form-data");
}

function pushMultipartFile(files: Map<string, string[]>, field: string, filePath: string): void {
  const paths = files.get(field) ?? [];
  paths.push(filePath);
  files.set(field, paths);
}

function parseMultipartFilePair(raw: string): { field: string; filePath: string } {
  const eq = raw.indexOf("=");
  if (eq <= 0 || eq === raw.length - 1) {
    die(`--multipart-file requires <field>=<path>, got: ${raw}`);
  }
  return { field: raw.slice(0, eq), filePath: raw.slice(eq + 1) };
}

function extractMultipartFileArgs(rawArgs: string[]): {
  args: string[];
  files: Map<string, string[]>;
} {
  const args: string[] = [];
  const files = new Map<string, string[]>();

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i] ?? "";
    if (arg === "--multipart-file") {
      const next = rawArgs[++i];
      if (next === undefined) die("--multipart-file requires <field>=<path>");
      const { field, filePath } = parseMultipartFilePair(next);
      pushMultipartFile(files, field, filePath);
      continue;
    }
    if (arg.startsWith("--multipart-file=")) {
      const { field, filePath } = parseMultipartFilePair(arg.slice("--multipart-file=".length));
      pushMultipartFile(files, field, filePath);
      continue;
    }
    args.push(arg);
  }

  return { args, files };
}

function multipartFileDefaults(files: Map<string, string[]>): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [field, paths] of files) {
    defaults[field] = paths.length === 1 ? (paths[0] ?? "") : paths;
  }
  return defaults;
}

function stringOrArrayFileSchema(schema: unknown): Record<string, unknown> {
  const base =
    schema && typeof schema === "object" && !Array.isArray(schema) ? (schema as Record<string, unknown>) : {};
  return { ...base, type: ["string", "array"], items: { type: "string" } };
}

function multipartParsingSchema(tool: ApiTool, explicitFiles: Map<string, string[]>): Record<string, unknown> {
  const schema = tool.inputSchema as {
    properties?: Record<string, unknown>;
  };
  const properties = { ...(schema.properties ?? {}) };
  for (const field of new Set([...Object.keys(tool.multipartFields ?? {}), ...explicitFiles.keys()])) {
    properties[field] = stringOrArrayFileSchema(properties[field]);
  }
  return { ...tool.inputSchema, properties };
}

function appendFormValue(form: FormData, parts: MultipartPart[], name: string, value: unknown): void {
  const stringValue = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
  form.append(name, stringValue);
  parts.push({ name, value: stringValue });
}

function appendFormFile(form: FormData, parts: MultipartPart[], name: string, filePath: string): void {
  form.append(name, Bun.file(filePath), basename(filePath));
  parts.push({ name, value: filePath, filePath });
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function buildMultipartBody(
  args: Record<string, unknown>,
  multipartFields: Record<string, MultipartField> | undefined,
  explicitFiles: Map<string, string[]>,
): { body: FormData; parts: MultipartPart[] } {
  const form = new FormData();
  const parts: MultipartPart[] = [];
  const fileFields = new Set([...Object.keys(multipartFields ?? {}), ...explicitFiles.keys()]);

  for (const [name, value] of Object.entries(args)) {
    if (fileFields.has(name)) {
      for (const filePath of asArray(value)) {
        appendFormFile(form, parts, name, String(filePath));
      }
    } else {
      appendFormValue(form, parts, name, value);
    }
  }

  return { body: form, parts };
}

export function formatApiToolHelp(
  tool: ApiTool,
  injectedArgs: Record<string, unknown> = tool.injectedArgs ?? {},
): TargetResult {
  const result = formatToolHelp(tool, injectedArgs);
  if (!isMultipartContentType(tool.bodyContentType)) return result;

  const fileFields = Object.keys(tool.multipartFields ?? {});
  const lines = [
    "",
    "Multipart:",
    "  content-type: multipart/form-data",
    fileFields.length > 0 ? `  file fields: ${fileFields.join(", ")}` : undefined,
    "  --multipart-file <field>=<path>   Add a file part; repeat for multiple files",
  ].filter((line): line is string => line !== undefined);

  return { ...result, stdout: `${result.stdout}${lines.join("\n")}\n` };
}

export function buildApiRequest(
  target: ApiTarget,
  tool: ApiTool,
  specBaseUrl: string | undefined,
  rawArgs: string[],
  globalHeaders: Record<string, string> = {},
  targetName?: string,
): {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: ApiRequestBody;
  multipartParts?: MultipartPart[];
  injectedArgs: Record<string, unknown>;
} {
  const mergedHeaders = mergeHeadersCaseInsensitive(target.headers, globalHeaders);
  const injectedArgs = buildInjectedHeaderArgs(tool.headerParams, mergedHeaders);

  let rawBaseUrl = target.baseUrl ?? specBaseUrl ?? "";
  // 상대 경로 baseUrl을 spec URL 기준으로 절대 경로로 변환
  if (rawBaseUrl && !rawBaseUrl.startsWith("http://") && !rawBaseUrl.startsWith("https://")) {
    try {
      rawBaseUrl = new URL(rawBaseUrl, target.openapiUrl).toString();
    } catch {
      /* rawBaseUrl 그대로 사용 */
    }
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    const suffix = targetName ? ` for "${targetName}"` : "";
    die(`No baseUrl: OpenAPI spec has no servers[], add "baseUrl" to config.yml${suffix}`);
  }

  const ct = tool.bodyContentType ?? "application/json";
  const isMultipart = isMultipartContentType(ct);
  const multipartInput = isMultipart
    ? extractMultipartFileArgs(rawArgs)
    : { args: rawArgs, files: new Map<string, string[]>() };
  const inputSchema = isMultipart ? multipartParsingSchema(tool, multipartInput.files) : tool.inputSchema;
  const args = parseToolArgs(multipartInput.args, inputSchema, {
    ...injectedArgs,
    ...multipartFileDefaults(multipartInput.files),
  });

  let urlPath = tool.path;
  for (const param of tool.pathParams) {
    const val = args[param];
    if (val !== undefined) {
      urlPath = urlPath.replace(`{${param}}`, encodeURIComponent(String(val)));
      delete args[param];
    }
  }

  const queryParams = new URLSearchParams();
  for (const param of tool.queryParams) {
    const val = args[param];
    if (val !== undefined) {
      const str = typeof val === "object" ? JSON.stringify(val) : String(val);
      queryParams.set(param, str);
      delete args[param];
    }
  }

  for (const param of tool.headerParams) {
    const val = args[param];
    if (val !== undefined) {
      setHeaderValue(mergedHeaders, param, String(val));
      delete args[param];
    }
  }

  const qs = queryParams.toString();
  const url = `${baseUrl}${urlPath}${qs ? `?${qs}` : ""}`;

  let body: ApiRequestBody;
  let multipartParts: MultipartPart[] | undefined;
  const remainingArgs = { ...args };
  const hasbody = Object.keys(remainingArgs).length > 0;

  if (hasbody) {
    if (isMultipart) {
      const multipart = buildMultipartBody(remainingArgs, tool.multipartFields, multipartInput.files);
      body = multipart.body;
      multipartParts = multipart.parts;
      deleteHeaderValue(mergedHeaders, "Content-Type");
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(remainingArgs)) {
        form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      body = form;
      setHeaderValue(mergedHeaders, "Content-Type", "application/x-www-form-urlencoded");
    } else {
      body = JSON.stringify(remainingArgs);
      setHeaderValue(mergedHeaders, "Content-Type", "application/json");
    }
  }

  return { method: tool.method, url, headers: mergedHeaders, body, multipartParts, injectedArgs };
}

export async function executeApi(target: ApiTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { headers: globalHeaders, subcommand, args: rawArgs, targetName, dryRun } = ctx;
  const forceRefresh = subcommand === "refresh";
  const timeoutMs = resolveTargetTimeoutMs(target);
  const raw = await loadSpec(targetName, target, forceRefresh, timeoutMs);
  const spec = parseOpenApi(raw);

  if (subcommand === "refresh") {
    return {
      exitCode: 0,
      stdout: `Refreshed "${targetName}" spec (${spec.tools.length} operations)\n`,
      stderr: "",
    };
  }

  if (subcommand === "tools") {
    const scripts = buildAliasSection(target);
    if (spec.tools.length === 0) {
      return { exitCode: 0, stdout: `No operations available.${scripts}\n`, stderr: "" };
    }
    const lines = spec.tools.map((t) => {
      const desc = t.description.split("\n")[0] ?? "";
      const truncated = desc.length > 60 ? `${desc.slice(0, 57)}...` : desc;
      return `  ${t.name.padEnd(24)} ${truncated}`;
    });
    return { exitCode: 0, stdout: `Tools:\n${lines.join("\n")}\n${scripts}`, stderr: "" };
  }

  const tool = spec.tools.find((t) => t.name === subcommand);
  if (!tool) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Tool "${subcommand}" not found. Run: clip ${targetName} tools\n`,
    };
  }

  const injectedHeaderArgs = buildInjectedHeaderArgs(
    tool.headerParams,
    mergeHeadersCaseInsensitive(target.headers, globalHeaders),
  );

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    return formatApiToolHelp(tool, injectedHeaderArgs);
  }

  const request = buildApiRequest(target, tool, spec.baseUrl, rawArgs, globalHeaders, targetName);

  if (dryRun) {
    return {
      exitCode: 0,
      stdout: buildCurlCommand(request.method, request.url, request.headers, request.body, request.multipartParts),
      stderr: "",
    };
  }

  const client = new AuthenticatedClient({
    targetName,
    targetType: "api",
    serverUrl: target.baseUrl ?? request.url,
    oauthEnabled: target.auth === "oauth",
    configDir: resolveAuthDir(targetName, "api"),
  });

  // 사전 auth 헤더 주입 (client.fetch 내부에서도 401 재시도를 처리함)
  const authHeaders = await client.getAuthHeaders();
  for (const [key, value] of Object.entries(authHeaders)) {
    setHeaderValue(request.headers, key, value);
  }

  const { resp, respCt, respText } = await withTargetTimeoutSignal(
    timeoutMs,
    `API ${request.method.toUpperCase()} ${request.url}`,
    async (signal) => {
      const resp = await client.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal,
      });
      return {
        resp,
        respCt: resp.headers.get("Content-Type") ?? "",
        respText: await resp.text(),
      };
    },
  ).catch((e: unknown) => {
    if (e instanceof ClipError) throw e;
    die(`Failed to connect to ${request.url}: ${e}`);
  });

  if (!resp.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `HTTP ${resp.status} ${resp.statusText}\n${respText}\n`,
    };
  }

  const isBinary =
    respCt.startsWith("image/") ||
    respCt.startsWith("application/octet-stream") ||
    respCt.startsWith("application/pdf") ||
    respCt.startsWith("audio/") ||
    respCt.startsWith("video/");

  if (isBinary) {
    return {
      exitCode: 0,
      stdout: `<binary, ${respText.length} bytes, content-type: ${respCt}>\n`,
      stderr: "",
    };
  }

  let stdout: string;
  if (respCt.includes("json")) {
    try {
      stdout = `${JSON.stringify(JSON.parse(respText), null, 2)}\n`;
    } catch {
      stdout = respText + (respText.endsWith("\n") ? "" : "\n");
    }
  } else {
    stdout = respText + (respText.endsWith("\n") ? "" : "\n");
  }

  return { exitCode: 0, stdout, stderr: "" };
}

export async function describeApiTools(
  target: ApiTarget,
  targetName: string,
  globalHeaders: Record<string, string> = {},
): Promise<Tool[]> {
  const raw = await loadSpec(targetName, target);
  const mergedHeaders = mergeHeadersCaseInsensitive(target.headers, globalHeaders);

  return parseOpenApi(raw).tools.map((tool) => ({
    ...tool,
    injectedArgs: buildInjectedHeaderArgs(tool.headerParams, mergedHeaders),
  }));
}
