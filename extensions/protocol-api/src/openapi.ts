// OpenAPI 3.x / Swagger 2.0 최소 파서 — 외부 의존성 없음

export type MultipartField = {
  file: boolean;
  multiple?: boolean;
};

export type ApiTool = {
  name: string;
  description: string;
  method: string;
  path: string;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  bodyContentType?: string;
  multipartFields?: Record<string, MultipartField>;
  inputSchema: Record<string, unknown>;
};

export type ParsedSpec = {
  baseUrl: string | undefined;
  securitySchemes: Record<string, unknown>;
  globalSecurity: unknown[];
  tools: ApiTool[];
};

// --- ref 해석 ---

export function resolveRef(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    process.stderr.write(`clip: warning: remote $ref not supported, skipping: ${ref}\n`);
    return {};
  }
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const part of parts) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    if (cur == null || typeof cur !== "object") return {};
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur ?? {};
}

function deref(root: unknown, val: unknown): unknown {
  if (val && typeof val === "object" && "$ref" in (val as object)) {
    return deref(root, resolveRef(root, (val as { $ref: string }).$ref));
  }
  return val;
}

// --- 이름 생성 ---

export function toolNameFromOp(method: string, path: string, opId?: string): string {
  if (opId) {
    return opId
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  const sanitized =
    path
      .replace(/\{[^}]+\}/g, (m) => m.slice(1, -1))
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "root";
  return `${method.toLowerCase()}-${sanitized}`;
}

// --- 스키마 flatten ---

type ParamDef = {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
  description?: string;
  type?: string;
  format?: string;
  items?: unknown;
};

function paramSchema(p: ParamDef): Record<string, unknown> {
  if (p.schema) return p.schema as Record<string, unknown>;
  if (p.type === "file") return { type: "string", format: "binary" };
  return {
    type: p.type ?? "string",
    ...(p.format ? { format: p.format } : {}),
    ...(p.items ? { items: p.items } : {}),
  };
}

function isBinaryFileSchema(schema: Record<string, unknown>): boolean {
  return schema.type === "string" && (schema.format === "binary" || schema.format === "file");
}

function isBinaryFileArraySchema(schema: Record<string, unknown>): boolean {
  const items = schema.items as Record<string, unknown> | undefined;
  return schema.type === "array" && !!items && isBinaryFileSchema(items);
}

function multipartFieldForSchema(schema: Record<string, unknown>): MultipartField | undefined {
  if (isBinaryFileSchema(schema)) return { file: true };
  if (isBinaryFileArraySchema(schema)) return { file: true, multiple: true };
  return undefined;
}

function chooseBodyContentType(
  root: unknown,
  content: Record<string, unknown> | undefined,
  swaggerConsumes: string | undefined,
): string | undefined {
  if (!content) return swaggerConsumes;
  const contentTypes = Object.keys(content);
  const multipart = contentTypes.find((ct) => ct.includes("multipart/form-data"));
  if (multipart) {
    const entry = content[multipart] as { schema?: unknown } | undefined;
    const schema = deref(root, entry?.schema) as Record<string, unknown> | undefined;
    const props = schema?.properties as Record<string, unknown> | undefined;
    const hasBinary = Object.values(props ?? {}).some(
      (prop) => !!multipartFieldForSchema(deref(root, prop) as Record<string, unknown>),
    );
    if (hasBinary) return multipart;
  }
  return contentTypes[0];
}

function flattenParams(
  root: unknown,
  params: ParamDef[],
  requestBody: unknown,
  bodyContentType: string | undefined,
): {
  inputSchema: Record<string, unknown>;
  pathParams: string[];
  queryParams: string[];
  headerParams: string[];
  hasFormData: boolean;
  multipartFields: Record<string, MultipartField>;
} {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const pathParams: string[] = [];
  const queryParams: string[] = [];
  const headerParams: string[] = [];
  const multipartFields: Record<string, MultipartField> = {};
  let hasFormData = false;

  for (const p of params) {
    const schema = deref(root, paramSchema(p)) as Record<string, unknown>;
    const propSchema = { ...schema, description: p.description ?? (schema.description as string | undefined) };
    properties[p.name] = propSchema;
    if (p.required) required.push(p.name);
    if (p.in === "path") pathParams.push(p.name);
    else if (p.in === "query") queryParams.push(p.name);
    else if (p.in === "header") headerParams.push(p.name);
    else if (p.in === "formData") {
      hasFormData = true;
      const multipartField = multipartFieldForSchema(schema);
      if (multipartField) multipartFields[p.name] = multipartField;
    }
    // cookie params are dropped
  }

  if (requestBody) {
    const rb = deref(root, requestBody) as Record<string, unknown>;
    const content = rb.content as Record<string, { schema?: unknown }> | undefined;
    const ct = bodyContentType ?? (content ? Object.keys(content)[0] : undefined);
    if (ct && content?.[ct]?.schema) {
      const isMultipart = ct.includes("multipart/form-data");
      const bodySchema = deref(root, content[ct]?.schema) as Record<string, unknown>;
      const bodyProps = bodySchema.properties as Record<string, unknown> | undefined;
      const bodyRequired = bodySchema.required as string[] | undefined;

      if (bodyProps) {
        const paramNames = new Set(Object.keys(properties));
        for (const [k, v] of Object.entries(bodyProps)) {
          const finalKey = paramNames.has(k) ? `body_${k}` : k;
          const propSchema = deref(root, v) as Record<string, unknown>;
          properties[finalKey] = propSchema;
          if (bodyRequired?.includes(k)) required.push(finalKey);
          if (isMultipart) {
            const multipartField = multipartFieldForSchema(propSchema);
            if (multipartField) multipartFields[finalKey] = multipartField;
          }
        }
      } else {
        // primitive/array body
        properties.body = bodySchema;
        if (rb.required) required.push("body");
      }
    }
  }

  const inputSchema: Record<string, unknown> = { type: "object", properties };
  if (required.length) inputSchema.required = required;
  return { inputSchema, pathParams, queryParams, headerParams, hasFormData, multipartFields };
}

// --- baseUrl 추출 ---

function extractBaseUrl(spec: Record<string, unknown>): string | undefined {
  // OpenAPI 3.x
  const servers = spec.servers as Array<{ url: string; variables?: Record<string, { default: string }> }> | undefined;
  if (servers?.length) {
    let url = servers[0]?.url;
    const vars = servers[0]?.variables ?? {};
    for (const [k, v] of Object.entries(vars)) {
      url = url.replace(`{${k}}`, v.default);
    }
    return url;
  }
  // Swagger 2.0
  const host = spec.host as string | undefined;
  if (host) {
    const basePath = (spec.basePath as string | undefined) ?? "/";
    const schemes = (spec.schemes as string[] | undefined) ?? ["https"];
    return `${schemes[0]}://${host}${basePath}`.replace(/\/+$/, "");
  }
  return undefined;
}

// --- 메인 파서 ---

export function parseOpenApi(raw: unknown): ParsedSpec {
  const spec = raw as Record<string, unknown>;
  const baseUrl = extractBaseUrl(spec);

  // securitySchemes
  const components = spec.components as Record<string, unknown> | undefined;
  const definitions = spec.securityDefinitions as Record<string, unknown> | undefined;
  const securitySchemes = (components?.securitySchemes as Record<string, unknown> | undefined) ?? definitions ?? {};
  const globalSecurity = (spec.security as unknown[]) ?? [];

  const tools: ApiTool[] = [];
  const nameCount: Record<string, number> = {};

  const paths = (spec.paths as Record<string, Record<string, unknown>>) ?? {};
  const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

  for (const [pathStr, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathLevelParams = ((pathItem as Record<string, unknown>).parameters as ParamDef[] | undefined) ?? [];

    for (const method of HTTP_METHODS) {
      const op = (pathItem as Record<string, unknown>)[method] as Record<string, unknown> | undefined;
      if (!op) continue;

      const opId = op.operationId as string | undefined;
      let name = toolNameFromOp(method, pathStr, opId);

      // dedup
      const existing = nameCount[name] ?? 0;
      if (existing > 0) {
        nameCount[name] = existing + 1;
        name = `${name}-${existing + 1}`;
      } else {
        nameCount[name] = 1;
      }

      const opParams = (op.parameters as ParamDef[] | undefined) ?? [];
      // path-level params are overridden by op-level if same name+in
      const mergedParamsMap = new Map<string, ParamDef>();
      for (const p of [...pathLevelParams, ...opParams]) {
        mergedParamsMap.set(`${p.in}:${p.name}`, p);
      }
      const mergedParams = Array.from(mergedParamsMap.values());

      const requestBody = op.requestBody;
      const rb = requestBody ? (deref(spec, requestBody) as Record<string, unknown>) : undefined;
      const content = rb?.content as Record<string, unknown> | undefined;
      // OpenAPI 3.x: content에서, Swagger 2.0: operation 또는 root-level consumes에서
      const opConsumes = op.consumes as string[] | undefined;
      const globalConsumes = spec.consumes as string[] | undefined;
      const swaggerConsumes = (opConsumes ?? globalConsumes)?.[0];
      const bodyContentType = chooseBodyContentType(spec, content, swaggerConsumes);

      const { inputSchema, pathParams, queryParams, headerParams, hasFormData, multipartFields } = flattenParams(
        spec,
        mergedParams,
        requestBody,
        bodyContentType,
      );

      // formData 파라미터가 있는데 bodyContentType이 결정되지 않은 경우 url-encoded로 기본 설정
      const effectiveBodyCt = bodyContentType ?? (hasFormData ? "application/x-www-form-urlencoded" : undefined);

      const summary = (op.summary as string | undefined) ?? "";
      const desc = (op.description as string | undefined) ?? "";
      const description = [summary, desc].filter(Boolean).join("\n\n") || `${method.toUpperCase()} ${pathStr}`;

      tools.push({
        name,
        description,
        method: method.toUpperCase(),
        path: pathStr,
        pathParams,
        queryParams,
        headerParams,
        bodyContentType: effectiveBodyCt,
        ...(Object.keys(multipartFields).length > 0 ? { multipartFields } : {}),
        inputSchema,
      });
    }
  }

  return { baseUrl, securitySchemes, globalSecurity, tools };
}
