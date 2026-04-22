import { join } from "path";
import YAML from "yaml";
import { AuthenticatedClient, resolveAuthDir } from "@clip/auth";
import { CONFIG_DIR, buildAliasSection, die, findTargetConfigDir, formatToolHelp, parseToolArgs } from "@clip/core";
import type { ExecutorContext, TargetResult, Tool } from "@clip/core";
import { parseOpenApi } from "./openapi.ts";
import type { ApiTarget } from "./schema.ts";

function specCachePath(targetName: string): string {
  const dir = findTargetConfigDir(targetName, "api") ?? join(CONFIG_DIR, "target", "api", targetName);
  return join(dir, "spec.json");
}

async function loadSpec(targetName: string, target: ApiTarget, forceRefresh = false): Promise<unknown> {
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

  let resp: Response;
  if (target.auth === "oauth") {
    const client = new AuthenticatedClient({
      targetName,
      targetType: "api",
      serverUrl: specUrl,
      oauthEnabled: true,
      configDir: resolveAuthDir(targetName, "api"),
    });
    resp = await client.fetch(specUrl).catch((e: unknown) => {
      die(`Failed to fetch OpenAPI spec from ${specUrl}: ${e}`);
    });
  } else {
    resp = await fetch(specUrl).catch((e: unknown) => {
      die(`Failed to fetch OpenAPI spec from ${specUrl}: ${e}`);
    });
  }
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

  const dir = findTargetConfigDir(targetName, "api") ?? join(CONFIG_DIR, "target", "api", targetName);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(cachePath, JSON.stringify(parsed, null, 2));

  return parsed;
}

const sq = (s: string) => s.replace(/'/g, "'\\''");

export function buildCurlCommand(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: string | URLSearchParams | undefined,
): string {
  const parts = [`curl -X ${method.toUpperCase()} '${url}'`];
  for (const [k, v] of Object.entries(headers)) {
    parts.push(`  -H '${sq(k)}: ${sq(v)}'`);
  }
  if (body instanceof URLSearchParams) {
    // URLSearchParams.toString() is already URL-encoded; --data-urlencode would double-encode
    parts.push(`  --data-raw '${body.toString()}'`);
  } else if (body) {
    parts.push(`  -d '${sq(body)}'`);
  }
  return `${parts.join(" \\\n")}\n`;
}

export async function executeApi(target: ApiTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { headers: globalHeaders, subcommand, args: rawArgs, targetName, dryRun } = ctx;
  const forceRefresh = subcommand === "refresh";
  const raw = await loadSpec(targetName, target, forceRefresh);
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

  const mergedHeaders: Record<string, string> = {
    ...(target.headers ?? {}),
    ...(globalHeaders ?? {}),
  };

  let rawBaseUrl = target.baseUrl ?? spec.baseUrl ?? "";
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

  const client = new AuthenticatedClient({
    targetName,
    targetType: "api",
    serverUrl: target.baseUrl ?? fullUrl,
    oauthEnabled: target.auth === "oauth",
    configDir: resolveAuthDir(targetName, "api"),
  });

  // 사전 auth 헤더 주입 (client.fetch 내부에서도 401 재시도를 처리함)
  const authHeaders = await client.getAuthHeaders();
  Object.assign(mergedHeaders, authHeaders);

  const resp = await client.fetch(fullUrl, {
    method: tool.method,
    headers: mergedHeaders,
    body,
  }).catch((e: unknown) => {
    die(`Failed to connect to ${fullUrl}: ${e}`);
  });

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

export async function describeApiTools(target: ApiTarget, targetName: string): Promise<Tool[]> {
  const raw = await loadSpec(targetName, target);
  return parseOpenApi(raw).tools;
}
