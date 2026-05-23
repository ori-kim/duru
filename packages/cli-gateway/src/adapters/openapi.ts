import type { GatewayTool } from "../types";

export type OpenApiTool = GatewayTool & {
  method: string;
  path: string;
  pathParams: readonly string[];
  queryParams: readonly string[];
  headerParams: readonly string[];
  bodyContentType?: string;
};

export type ParsedOpenApi = {
  baseUrl?: string;
  tools: readonly OpenApiTool[];
};

type ParameterObject = {
  name?: unknown;
  in?: unknown;
  required?: unknown;
  description?: unknown;
  schema?: unknown;
  type?: unknown;
  format?: unknown;
  items?: unknown;
};

const httpMethods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

export function parseOpenApi(raw: unknown): ParsedOpenApi {
  const spec = isRecord(raw) ? raw : {};
  const tools: OpenApiTool[] = [];
  const counts = new Map<string, number>();
  const paths = isRecord(spec.paths) ? spec.paths : {};

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) continue;
    const pathParams = parameterList(spec, pathItem.parameters);

    for (const method of httpMethods) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;

      const params = mergeParameters(pathParams, parameterList(spec, operation.parameters));
      const body = requestBodyInfo(operation.requestBody, spec);
      const tool = toolFromOperation({
        method,
        path,
        operation,
        params,
        body,
        name: uniqueName(toolName(method, path, stringValue(operation.operationId)), counts),
      });
      tools.push(tool);
    }
  }

  return {
    ...(extractBaseUrl(spec) ? { baseUrl: extractBaseUrl(spec) } : {}),
    tools,
  };
}

function toolFromOperation(input: {
  method: string;
  path: string;
  operation: Record<string, unknown>;
  params: readonly ParameterObject[];
  body: BodyInfo | undefined;
  name: string;
}): OpenApiTool {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  const headerParams: string[] = [];

  for (const param of input.params) {
    if (typeof param.name !== "string" || typeof param.in !== "string") continue;
    const schema = paramSchema(param);
    properties[param.name] = {
      ...schema,
      ...(typeof param.description === "string" ? { description: param.description } : {}),
    };
    if (param.required === true) required.push(param.name);
    if (param.in === "path") pathParams.push(param.name);
    if (param.in === "query") queryParams.push(param.name);
    if (param.in === "header") headerParams.push(param.name);
  }

  if (input.body?.schema) {
    const bodyProps = isRecord(input.body.schema.properties) ? input.body.schema.properties : undefined;
    if (bodyProps) {
      for (const [key, value] of Object.entries(bodyProps)) properties[key] = value;
      if (Array.isArray(input.body.schema.required)) {
        for (const key of input.body.schema.required) if (typeof key === "string") required.push(key);
      }
    } else {
      properties.body = input.body.schema;
      if (input.body.required) required.push("body");
    }
  }

  const summary = stringValue(input.operation.summary);
  const description = [summary, stringValue(input.operation.description)].filter(Boolean).join("\n\n");
  const inputSchema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };

  return {
    name: input.name,
    description: description || `${input.method.toUpperCase()} ${input.path}`,
    inputSchema,
    method: input.method.toUpperCase(),
    path: input.path,
    pathParams,
    queryParams,
    headerParams,
    ...(input.body?.contentType ? { bodyContentType: input.body.contentType } : {}),
  };
}

type BodyInfo = {
  schema?: Record<string, unknown>;
  contentType?: string;
  required?: boolean;
};

function requestBodyInfo(value: unknown, root: Record<string, unknown>): BodyInfo | undefined {
  const requestBody = dereference(root, value);
  if (!isRecord(requestBody)) return undefined;

  const content = isRecord(requestBody.content) ? requestBody.content : undefined;
  const contentType = content ? Object.keys(content)[0] : undefined;
  const media = contentType ? dereference(root, content?.[contentType]) : undefined;
  const schema = isRecord(media) ? dereference(root, media.schema) : undefined;

  return {
    ...(isRecord(schema) ? { schema } : {}),
    ...(contentType ? { contentType } : {}),
    ...(requestBody.required === true ? { required: true } : {}),
  };
}

function mergeParameters(
  pathParams: readonly ParameterObject[],
  operationParams: readonly ParameterObject[],
): readonly ParameterObject[] {
  const params = new Map<string, ParameterObject>();
  for (const param of [...pathParams, ...operationParams]) {
    if (typeof param.name !== "string" || typeof param.in !== "string") continue;
    params.set(`${param.in}:${param.name}`, param);
  }
  return [...params.values()];
}

function parameterList(root: Record<string, unknown>, value: unknown): readonly ParameterObject[] {
  return Array.isArray(value) ? value.map((item) => dereference(root, item)).filter(isRecord) : [];
}

function paramSchema(param: ParameterObject): Record<string, unknown> {
  if (isRecord(param.schema)) return param.schema;
  return {
    type: typeof param.type === "string" ? param.type : "string",
    ...(typeof param.format === "string" ? { format: param.format } : {}),
    ...(param.items ? { items: param.items } : {}),
  };
}

function extractBaseUrl(spec: Record<string, unknown>): string | undefined {
  const servers = Array.isArray(spec.servers) ? spec.servers : undefined;
  const firstServer = servers?.find(isRecord);
  const serverUrl = firstServer ? stringValue(firstServer.url) : undefined;
  if (serverUrl) return applyServerVariables(serverUrl, firstServer?.variables);

  const host = stringValue(spec.host);
  if (!host) return undefined;
  const schemes = Array.isArray(spec.schemes)
    ? spec.schemes.filter((item): item is string => typeof item === "string")
    : [];
  const scheme = schemes[0] ?? "https";
  const basePath = stringValue(spec.basePath) ?? "/";
  return `${scheme}://${host}${basePath}`.replace(/\/+$/, "");
}

function applyServerVariables(url: string, variables: unknown): string {
  if (!isRecord(variables)) return url;
  let result = url;
  for (const [key, value] of Object.entries(variables)) {
    if (isRecord(value) && typeof value.default === "string") {
      result = result.replace(`{${key}}`, value.default);
    }
  }
  return result;
}

function toolName(method: string, path: string, operationId: string | undefined): string {
  if (operationId) return cleanName(operationId);
  const pathName = cleanName(path.replace(/\{([^}]+)\}/g, "$1")) || "root";
  return `${method.toLowerCase()}-${pathName}`;
}

function uniqueName(name: string, counts: Map<string, number>): string {
  const count = counts.get(name) ?? 0;
  counts.set(name, count + 1);
  return count === 0 ? name : `${name}-${count + 1}`;
}

function cleanName(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function dereference(root: Record<string, unknown>, value: unknown): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string") return value;
  if (!value.$ref.startsWith("#/")) return {};

  let cursor: unknown = root;
  for (const part of value.$ref.slice(2).split("/")) {
    if (!isRecord(cursor)) return {};
    cursor = cursor[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return dereference(root, cursor);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
