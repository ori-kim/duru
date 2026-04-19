import { homedir } from "os";
import { join } from "path";
import YAML from "yaml";
import type { ApiTarget } from "./config.ts";
import { die } from "./errors.ts";
import { formatToolHelp, parseToolArgs } from "./mcp-target.ts";
import { getStoredAuthHeaders, handleOAuth401, refreshIfExpiring } from "./oauth.ts";
import { parseOpenApi } from "./openapi.ts";
import type { TargetResult } from "./output.ts";
import { buildAliasSection } from "./alias.ts";

const API_DIR = join(homedir(), ".clip", "target", "api");

function specCachePath(targetName: string): string {
  return join(API_DIR, targetName, "spec.json");
}

async function loadSpec(targetName: string, specUrl: string | undefined, forceRefresh = false): Promise<unknown> {
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

  const resp = await fetch(specUrl).catch((e: unknown) => {
    die(`Failed to fetch OpenAPI spec from ${specUrl}: ${e}`);
  });
  if (!resp.ok) {
    die(`Failed to fetch OpenAPI spec: HTTP ${resp.status} from ${specUrl}`);
  }

  const text = await resp.text();
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

  const dir = join(API_DIR, targetName);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(cachePath, JSON.stringify(parsed, null, 2));

  return parsed;
}

function buildCurlCommand(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | URLSearchParams | undefined,
): string {
  const parts = [`curl -X ${method.toUpperCase()} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${k}: ${v}'`);
  }
  if (body instanceof URLSearchParams) {
    parts.push(`  --data-urlencode '${body.toString()}'`);
  } else if (body) {
    parts.push(`  -d '${body.replace(/'/g, "'\\''")}'`);
  }
  return `${parts.join(" \\\n")}\n`;
}

export async function executeApi(
  target: ApiTarget,
  globalHeaders: Record<string, string> | undefined,
  subcommand: string,
  rawArgs: string[],
  targetName: string,
  forceRefresh = false,
  dryRun = false,
): Promise<TargetResult> {
  const raw = await loadSpec(targetName, target.openapiUrl, forceRefresh);
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

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    return formatToolHelp(tool);
  }

  const oauthEnabled = target.auth === "oauth";
  const mergedHeaders: Record<string, string> = {
    ...(globalHeaders ?? {}),
    ...(target.headers ?? {}),
  };

  if (oauthEnabled) {
    const refreshed = await refreshIfExpiring(targetName, "api");
    if (refreshed) Object.assign(mergedHeaders, refreshed);

    const stored = await getStoredAuthHeaders(targetName, "api");
    if (stored) Object.assign(mergedHeaders, stored);
  }

  let rawBaseUrl = target.baseUrl ?? spec.baseUrl ?? "";
  // 상대 경로 baseUrl을 spec URL 기준으로 절대 경로로 변환
  if (rawBaseUrl && !rawBaseUrl.startsWith("http://") && !rawBaseUrl.startsWith("https://")) {
    try {
      rawBaseUrl = new URL(rawBaseUrl, target.openapiUrl).toString();
    } catch { /* rawBaseUrl 그대로 사용 */ }
  }
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (!baseUrl) {
    die(`No baseUrl: OpenAPI spec has no servers[], add "baseUrl" to config.yml for "${targetName}"`);
  }

  const args = parseToolArgs(rawArgs, tool.inputSchema);

  // URL 조립
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
      mergedHeaders[param] = String(val);
      delete args[param];
    }
  }

  const qs = queryParams.toString();
  const fullUrl = `${baseUrl}${urlPath}${qs ? `?${qs}` : ""}`;

  // body 조립
  let body: string | URLSearchParams | undefined;
  const remainingArgs = { ...args };
  const hasbody = Object.keys(remainingArgs).length > 0;

  const ct = tool.bodyContentType ?? "application/json";
  if (hasbody) {
    if (ct.includes("multipart/form-data")) {
      die(`multipart/form-data is not supported in v1. Use a different tool or set baseUrl manually.`);
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(remainingArgs)) {
        form.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
      }
      body = form;
      mergedHeaders["Content-Type"] = "application/x-www-form-urlencoded";
    } else {
      body = JSON.stringify(remainingArgs);
      mergedHeaders["Content-Type"] = "application/json";
    }
  }

  if (dryRun) {
    return { exitCode: 0, stdout: buildCurlCommand(tool.method, fullUrl, mergedHeaders, body), stderr: "" };
  }

  const doFetch = (headers: Record<string, string>) =>
    fetch(fullUrl, {
      method: tool.method,
      headers,
      body,
    }).catch((e: unknown) => {
      die(`Failed to connect to ${fullUrl}: ${e}`);
    });

  let resp = await doFetch(mergedHeaders);

  if (resp.status === 401 && oauthEnabled && target.baseUrl) {
    const authHeaders = await handleOAuth401(targetName, target.baseUrl, resp, "api");
    Object.assign(mergedHeaders, authHeaders);
    resp = await doFetch(mergedHeaders);
  }

  const respCt = resp.headers.get("Content-Type") ?? "";
  const respText = await resp.text();

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
      stdout = JSON.stringify(JSON.parse(respText), null, 2) + "\n";
    } catch {
      stdout = respText + (respText.endsWith("\n") ? "" : "\n");
    }
  } else {
    stdout = respText + (respText.endsWith("\n") ? "" : "\n");
  }

  return { exitCode: 0, stdout, stderr: "" };
}
