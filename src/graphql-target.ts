import { homedir } from "os";
import { join } from "path";
import type { GraphqlTarget } from "./config.ts";
import { die } from "./errors.ts";
import { formatToolHelp, parseToolArgs } from "./mcp-target.ts";
import { getStoredAuthHeaders, handleOAuth401, refreshIfExpiring } from "./oauth.ts";
import type { TargetResult } from "./output.ts";
import {
  INTROSPECTION_QUERY,
  buildOperation,
  describeField,
  describeType,
  findTool,
  gqlTypeToString,
  parseDotPath,
  parseIntrospection,
} from "./graphql-schema.ts";
import type { GqlSpec, IntrospectionField, IntrospectionInputValue } from "./graphql-schema.ts";

const GRAPHQL_DIR = join(homedir(), ".clip", "target", "graphql");
const BUILTIN_SCALARS = new Set(["Boolean", "String", "Int", "Float", "ID"]);

function schemaCachePath(targetName: string): string {
  return join(GRAPHQL_DIR, targetName, "schema.json");
}

async function buildHeaders(
  target: GraphqlTarget,
  targetName: string,
): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/graphql-response+json, application/json;q=0.9",
    ...(target.headers ?? {}),
  };

  const refreshed = await refreshIfExpiring(targetName, "graphql");
  if (refreshed) return { ...base, ...refreshed };

  const stored = await getStoredAuthHeaders(targetName, "graphql");
  if (stored) return { ...base, ...stored };

  return base;
}

async function postGraphql(
  target: GraphqlTarget,
  targetName: string,
  body: Record<string, unknown>,
  existingHeaders?: Record<string, string>,
): Promise<{ resp: Response; json: Record<string, unknown> }> {
  const headers = existingHeaders ?? await buildHeaders(target, targetName);
  const resp = await fetch(target.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (resp.status === 401 && target.oauth) {
    const newHeaders = await handleOAuth401(targetName, target.endpoint, resp, "graphql");
    const retry = await fetch(target.endpoint, {
      method: "POST",
      headers: { ...headers, ...newHeaders },
      body: JSON.stringify(body),
    });
    const json = (await retry.json()) as Record<string, unknown>;
    return { resp: retry, json };
  }

  const json = (await resp.json()) as Record<string, unknown>;
  return { resp, json };
}

async function loadSchema(
  target: GraphqlTarget,
  targetName: string,
  forceRefresh = false,
): Promise<GqlSpec> {
  const cachePath = schemaCachePath(targetName);
  const cacheFile = Bun.file(cachePath);

  if (!forceRefresh && (await cacheFile.exists())) {
    try {
      const raw = JSON.parse(await cacheFile.text()) as Record<string, unknown>;
      return parseIntrospection(raw);
    } catch { /* 손상 → 재fetch */ }
  }

  if (target.introspect === false) {
    die(
      `"${targetName}" has introspect: false and no cached schema.\n` +
      `Place introspection response at: ${cachePath}`,
    );
  }

  const headers = await buildHeaders(target, targetName);
  const { resp, json } = await postGraphql(target, targetName, { query: INTROSPECTION_QUERY }, headers);

  if (!resp.ok) {
    die(`Failed to introspect "${targetName}": HTTP ${resp.status}\n${JSON.stringify(json).slice(0, 400)}`);
  }

  const errors = json["errors"] as unknown[] | undefined;
  if (errors?.length) {
    die(`Introspection error for "${targetName}":\n${JSON.stringify(errors, null, 2).slice(0, 800)}`);
  }

  const data = json["data"] as Record<string, unknown> | null;
  if (!data?.["__schema"]) {
    die(`Introspection returned no __schema for "${targetName}"`);
  }

  const schemaObj = { __schema: data["__schema"] };
  const dir = join(GRAPHQL_DIR, targetName);
  await Bun.spawn(["mkdir", "-p", dir]).exited;
  await Bun.write(cachePath, JSON.stringify(schemaObj, null, 2));

  return parseIntrospection(schemaObj as Record<string, unknown>);
}

function formatToolsLine(
  tool: { rootField: string; args: { name: string; type: { kind: string; name: string | null; ofType: { kind: string; name: string | null; ofType: unknown } | null } }[]; returnType: { kind: string; name: string | null; ofType: unknown } },
  prefix: string,
): string {
  const argStr = tool.args.length > 0
    ? `(${tool.args.map((a) => a.name).join(", ")})`
    : "";
  return `  ${(prefix + tool.rootField + argStr).padEnd(40)} ${gqlTypeToString(tool.returnType as Parameters<typeof gqlTypeToString>[0])}`;
}

function buildToolsOutput(spec: GqlSpec): string {
  const queryTools = spec.tools.filter((t) => t.operationType === "query");
  const mutTools = spec.tools.filter((t) => t.operationType === "mutation");
  const hasBoth = queryTools.length > 0 && mutTools.length > 0;

  const lines: string[] = ["Tools:"];
  if (hasBoth) {
    lines.push("  [Query]");
    for (const t of queryTools) lines.push(formatToolsLine(t, "  "));
    lines.push("  [Mutation]");
    for (const t of mutTools) lines.push(formatToolsLine(t, "  "));
  } else {
    for (const t of spec.tools) lines.push(formatToolsLine(t, ""));
  }
  return lines.join("\n") + "\n";
}

async function executeQuery(
  target: GraphqlTarget,
  targetName: string,
  query: string,
  variables: Record<string, unknown>,
  operationName?: string,
): Promise<TargetResult> {
  const body: Record<string, unknown> = { query, variables };
  if (operationName) body["operationName"] = operationName;

  const { resp, json } = await postGraphql(target, targetName, body);

  if (!resp.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `HTTP ${resp.status}: ${JSON.stringify(json).slice(0, 800)}\n`,
    };
  }

  const data = json["data"] as Record<string, unknown> | null | undefined;
  const errors = json["errors"] as unknown[] | undefined;

  if (errors?.length) {
    const errStr = JSON.stringify(errors, null, 2) + "\n";
    if (data !== null && data !== undefined) {
      // partial data
      return {
        exitCode: 1,
        stdout: JSON.stringify(data, null, 2) + "\n",
        stderr: errStr,
      };
    }
    return { exitCode: 1, stdout: "", stderr: errStr };
  }

  return {
    exitCode: 0,
    stdout: JSON.stringify(data, null, 2) + "\n",
    stderr: "",
  };
}

export async function executeGraphql(
  target: GraphqlTarget,
  _globalHeaders: Record<string, string> | undefined,
  subcommand: string,
  rawArgs: string[],
  targetName: string,
  forceRefresh = false,
): Promise<TargetResult> {

  if (subcommand === "refresh") {
    const spec = await loadSchema(target, targetName, true);
    const total = spec.tools.length;
    const typeCount = [...spec.types.values()].filter(
      (t) => !BUILTIN_SCALARS.has(t.name) && !["Query", "Mutation", "Subscription"].includes(t.name),
    ).length;
    return {
      exitCode: 0,
      stdout: `Refreshed "${targetName}" schema (${total} tools, ${typeCount} types)\n`,
      stderr: "",
    };
  }

  const spec = await loadSchema(target, targetName, forceRefresh);

  if (subcommand === "tools") {
    if (spec.tools.length === 0) return { exitCode: 0, stdout: "No tools available.\n", stderr: "" };
    return { exitCode: 0, stdout: buildToolsOutput(spec), stderr: "" };
  }

  if (subcommand === "types") {
    const visible = [...spec.types.values()].filter(
      (t) => !BUILTIN_SCALARS.has(t.name) && t.kind !== "SCALAR" || (t.kind === "SCALAR" && !BUILTIN_SCALARS.has(t.name)),
    );
    if (visible.length === 0) return { exitCode: 0, stdout: "No types.\n", stderr: "" };
    const lines = ["Types:"];
    for (const t of visible.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${t.name.padEnd(32)} ${t.kind}`);
    }
    return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
  }

  if (subcommand === "describe") {
    const arg = rawArgs[0];
    if (!arg) {
      const lines = ["Services (root types):"];
      if (spec.queryTypeName) lines.push(`  ${spec.queryTypeName}  (${spec.tools.filter(t => t.operationType === "query").length} query fields)`);
      if (spec.mutationTypeName) lines.push(`  ${spec.mutationTypeName}  (${spec.tools.filter(t => t.operationType === "mutation").length} mutation fields)`);
      lines.push(`\nRun: clip ${targetName} types    — list all types`);
      return { exitCode: 0, stdout: lines.join("\n") + "\n", stderr: "" };
    }

    // TypeName.fieldName 형식 체크
    const dotIdx = arg.lastIndexOf(".");
    const typeName = dotIdx > 0 ? arg.slice(0, dotIdx) : arg;
    const fieldName = dotIdx > 0 ? arg.slice(dotIdx + 1) : undefined;

    const type = spec.types.get(typeName);
    if (!type) {
      // 도구 이름으로도 시도
      const tool = findTool(spec, arg);
      if (tool) {
        return formatToolHelp({
          name: arg,
          description: `GraphQL ${tool.operationType}: ${tool.rootField}\nReturn: ${gqlTypeToString(tool.returnType)}${tool.description ? "\n" + tool.description : ""}`,
          inputSchema: tool.inputSchema,
        });
      }
      return {
        exitCode: 1,
        stdout: "",
        stderr: `"${arg}" not found. Run: clip ${targetName} types\n`,
      };
    }

    if (fieldName) {
      const allFields: (IntrospectionField | IntrospectionInputValue)[] = [
        ...(type.fields ?? []),
        ...(type.inputFields ?? []),
      ];
      const field = allFields.find((f) => f.name === fieldName);
      if (!field) {
        return { exitCode: 1, stdout: "", stderr: `Field "${fieldName}" not found in "${typeName}".\n` };
      }
      return { exitCode: 0, stdout: describeField(field) + "\n", stderr: "" };
    }

    return { exitCode: 0, stdout: describeType(type) + "\n", stderr: "" };
  }

  if (subcommand === "query") {
    const rawQuery = rawArgs[0];
    if (!rawQuery) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Usage: clip ${targetName} query '<graphql query>' [--variables '{"key": "val"}']\n`,
      };
    }
    let variables: Record<string, unknown> = {};
    const varIdx = rawArgs.indexOf("--variables");
    if (varIdx !== -1 && rawArgs[varIdx + 1]) {
      try {
        variables = JSON.parse(rawArgs[varIdx + 1]!) as Record<string, unknown>;
      } catch {
        return { exitCode: 1, stdout: "", stderr: `Invalid JSON in --variables\n` };
      }
    }
    return executeQuery(target, targetName, rawQuery, variables);
  }

  // RPC 도구 호출
  const tool = findTool(spec, subcommand);
  if (!tool) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `Tool "${subcommand}" not found. Run: clip ${targetName} tools\n`,
    };
  }

  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    return formatToolHelp({
      name: subcommand,
      description:
        `GraphQL ${tool.operationType}: ${tool.rootField}\nReturn: ${gqlTypeToString(tool.returnType)}` +
        (tool.description ? "\n" + tool.description : "") +
        "\n\nSelection: pass '{ field1 field2 }' as last arg, or --select field.nested,other",
      inputSchema: tool.inputSchema,
    });
  }

  // selection 추출
  let selection: string | undefined;
  let remaining = [...rawArgs];

  const selIdx = remaining.indexOf("--select");
  if (selIdx !== -1 && remaining[selIdx + 1]) {
    selection = parseDotPath(remaining[selIdx + 1]!);
    remaining = remaining.filter((_, i) => i !== selIdx && i !== selIdx + 1);
  }

  const last = remaining[remaining.length - 1];
  if (!selection && last?.startsWith("{")) {
    selection = remaining.pop()!;
  }

  if (!selection) selection = tool.autoSelection;

  const variables = parseToolArgs(remaining, tool.inputSchema);
  const opName = `${tool.operationType === "query" ? "q" : "m"}_${tool.rootField}`;
  const query = buildOperation(tool, variables, selection);

  return executeQuery(target, targetName, query, variables, opName);
}
