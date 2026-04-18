// graphql-schema.ts — introspection 파서 + 쿼리 빌더 (외부 의존성 없음)

export const INTROSPECTION_QUERY = `
query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types { ...FullType }
  }
}
fragment FullType on __Type {
  kind
  name
  description
  fields(includeDeprecated: true) {
    name
    description
    args { ...InputValue }
    type { ...TypeRef }
    isDeprecated
  }
  inputFields { ...InputValue }
  enumValues(includeDeprecated: false) { name }
  possibleTypes { name kind }
}
fragment InputValue on __InputValue {
  name
  type { ...TypeRef }
  defaultValue
}
fragment TypeRef on __Type {
  kind name
  ofType { kind name ofType { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
}`.trim();

// --- 타입 ---

export type IntrospectionTypeRef = {
  kind: string;
  name: string | null;
  ofType: IntrospectionTypeRef | null;
};

export type IntrospectionInputValue = {
  name: string;
  type: IntrospectionTypeRef;
  defaultValue: string | null;
};

export type IntrospectionField = {
  name: string;
  description: string | null;
  args: IntrospectionInputValue[];
  type: IntrospectionTypeRef;
  isDeprecated: boolean;
};

export type IntrospectionType = {
  kind: string;
  name: string;
  description?: string | null;
  fields?: IntrospectionField[] | null;
  inputFields?: IntrospectionInputValue[] | null;
  enumValues?: { name: string }[] | null;
  possibleTypes?: { name: string; kind: string }[] | null;
};

export type GqlTool = {
  name: string;
  description: string | null;
  operationType: "query" | "mutation";
  rootField: string;
  args: IntrospectionInputValue[];
  returnType: IntrospectionTypeRef;
  inputSchema: Record<string, unknown>;
  autoSelection: string;
};

export type GqlSpec = {
  queryTypeName: string;
  mutationTypeName?: string;
  types: Map<string, IntrospectionType>;
  tools: GqlTool[];
};

// --- 표준 스칼라 매핑 ---

const STANDARD_SCALARS: Record<string, Record<string, unknown>> = {
  Int: { type: "integer" },
  Float: { type: "number" },
  Boolean: { type: "boolean" },
  String: { type: "string" },
  ID: { type: "string" },
};

// --- 헬퍼 ---

function getNamedType(ref: IntrospectionTypeRef): { name: string; kind: string } | null {
  if (ref.name) return { name: ref.name, kind: ref.kind };
  if (ref.ofType) return getNamedType(ref.ofType);
  return null;
}

// --- 공개 함수 ---

/** IntrospectionTypeRef → GraphQL 타입 문자열 (e.g. [Int!]!) */
export function gqlTypeToString(ref: IntrospectionTypeRef): string {
  if (ref.kind === "NON_NULL") return `${gqlTypeToString(ref.ofType!)}!`;
  if (ref.kind === "LIST") return `[${gqlTypeToString(ref.ofType!)}]`;
  return ref.name ?? "Unknown";
}

/** IntrospectionTypeRef → JSON Schema (재귀, 순환 방지) */
export function gqlTypeToJsonSchema(
  ref: IntrospectionTypeRef,
  types: Map<string, IntrospectionType>,
  seen: Set<string> = new Set(),
): Record<string, unknown> {
  if (ref.kind === "NON_NULL") return gqlTypeToJsonSchema(ref.ofType!, types, seen);
  if (ref.kind === "LIST") {
    return { type: "array", items: gqlTypeToJsonSchema(ref.ofType!, types, seen) };
  }

  const name = ref.name ?? "";
  if (STANDARD_SCALARS[name]) return { ...STANDARD_SCALARS[name]! };

  const type = types.get(name);
  if (!type) return {};

  if (type.kind === "SCALAR") return { description: `Custom scalar: ${name}` };
  if (type.kind === "ENUM") {
    return { type: "string", enum: type.enumValues?.map((v) => v.name) ?? [] };
  }

  if (type.kind === "INPUT_OBJECT") {
    if (seen.has(name)) return { type: "object", description: `recursive: ${name}` };
    const nextSeen = new Set(seen).add(name);
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const field of type.inputFields ?? []) {
      properties[field.name] = gqlTypeToJsonSchema(field.type, types, nextSeen);
      if (field.type.kind === "NON_NULL") required.push(field.name);
    }
    return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
  }

  return {};
}

/** 리턴 타입의 scalar 필드를 자동 선택 (빈 문자열 = 스칼라/enum 자체가 리프) */
export function autoSelect(
  returnType: IntrospectionTypeRef,
  types: Map<string, IntrospectionType>,
): string {
  const named = getNamedType(returnType);
  if (!named) return "";

  const type = types.get(named.name);
  if (!type) return "";

  if (type.kind === "SCALAR" || type.kind === "ENUM") return "";
  if (type.kind === "INTERFACE" || type.kind === "UNION") return "{ __typename }";
  if (type.kind !== "OBJECT") return "";

  const selected: string[] = [];
  for (const field of type.fields ?? []) {
    if (field.isDeprecated || field.args.length > 0) continue;
    const fieldNamed = getNamedType(field.type);
    if (!fieldNamed) continue;
    const fieldType = types.get(fieldNamed.name);
    if (!fieldType && !STANDARD_SCALARS[fieldNamed.name]) continue;
    const kind = fieldType?.kind ?? "SCALAR";
    if (kind === "SCALAR" || kind === "ENUM" || STANDARD_SCALARS[fieldNamed.name]) {
      selected.push(field.name);
    }
  }

  if (selected.length === 0) return "{ __typename }";
  return `{ ${selected.join(" ")} }`;
}

/** 최상위 쉼표로 분리 (괄호 안 쉼표 무시) */
function splitTopLevel(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (expr[i] === "," && depth === 0) {
      parts.push(expr.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(expr.slice(start).trim());
  return parts.filter(Boolean);
}

/** 최상위 점으로 분리 (괄호 안 점 무시) */
function splitDots(segment: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < segment.length; i++) {
    if (segment[i] === "(") depth++;
    else if (segment[i] === ")") depth--;
    else if (segment[i] === "." && depth === 0) {
      parts.push(segment.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(segment.slice(start));
  return parts;
}

type SelectNode = Map<string, SelectNode>;

function buildTree(paths: string[][]): SelectNode {
  const root: SelectNode = new Map();
  for (const path of paths) {
    let node = root;
    for (const seg of path) {
      if (!node.has(seg)) node.set(seg, new Map());
      node = node.get(seg)!;
    }
  }
  return root;
}

function treeToSelection(node: SelectNode): string {
  const parts: string[] = [];
  for (const [field, children] of node) {
    const inner = treeToSelection(children);
    parts.push(inner ? `${field} { ${inner} }` : field);
  }
  return parts.join(" ");
}

/** dot-path 표현식 → GraphQL selection set 문자열 (중괄호 포함) */
export function parseDotPath(expr: string): string {
  const segments = splitTopLevel(expr);
  const paths = segments.map(splitDots);
  const tree = buildTree(paths);
  const sel = treeToSelection(tree);
  return sel ? `{ ${sel} }` : "";
}

/** GraphQL operation 문자열 빌드 */
export function buildOperation(
  tool: GqlTool,
  variables: Record<string, unknown>,
  selection: string,
): string {
  const usedArgs = tool.args.filter((a) => a.name in variables);
  const varDefs = usedArgs.map((a) => `$${a.name}: ${gqlTypeToString(a.type)}`).join(", ");
  const argBind = usedArgs.map((a) => `${a.name}: $${a.name}`).join(", ");

  const opType = tool.operationType;
  const opName = `${opType === "query" ? "q" : "m"}_${tool.rootField}`;
  const varDecl = varDefs ? `(${varDefs})` : "";
  const argInvoke = argBind ? `(${argBind})` : "";
  const selSet = selection ? ` ${selection}` : "";

  return `${opType} ${opName}${varDecl} { ${tool.rootField}${argInvoke}${selSet} }`;
}

/** 타입 하나를 SDL 스타일로 출력 */
export function describeType(type: IntrospectionType): string {
  const lines: string[] = [];

  if (type.kind === "SCALAR") {
    const desc = type.description ? `\n# ${type.description}` : "";
    return `scalar ${type.name}${desc}`;
  }

  if (type.kind === "ENUM") {
    if (type.description) lines.push(`# ${type.description}`);
    lines.push(`enum ${type.name} {`);
    for (const v of type.enumValues ?? []) lines.push(`  ${v.name}`);
    lines.push("}");
    return lines.join("\n");
  }

  if (type.kind === "UNION") {
    const possible = (type.possibleTypes ?? []).map((t) => t.name).join(" | ");
    if (type.description) lines.push(`# ${type.description}`);
    lines.push(`union ${type.name} = ${possible}`);
    return lines.join("\n");
  }

  const keyword =
    type.kind === "INPUT_OBJECT" ? "input" :
    type.kind === "INTERFACE" ? "interface" : "type";

  if (type.description) lines.push(`# ${type.description}`);
  lines.push(`${keyword} ${type.name} {`);

  if (type.kind === "INPUT_OBJECT") {
    for (const f of type.inputFields ?? []) {
      const defVal = f.defaultValue ? ` = ${f.defaultValue}` : "";
      lines.push(`  ${f.name}: ${gqlTypeToString(f.type)}${defVal}`);
    }
  } else {
    for (const f of type.fields ?? []) {
      const argStr = f.args.length > 0
        ? `(${f.args.map((a) => `${a.name}: ${gqlTypeToString(a.type)}`).join(", ")})`
        : "";
      const deprecated = f.isDeprecated ? " @deprecated" : "";
      lines.push(`  ${f.name}${argStr}: ${gqlTypeToString(f.type)}${deprecated}`);
    }
  }

  lines.push("}");

  if (type.possibleTypes?.length) {
    lines.push(`# Possible types: ${type.possibleTypes.map((t) => t.name).join(", ")}`);
  }

  return lines.join("\n");
}

/** 단일 필드 상세 출력 */
export function describeField(field: IntrospectionField | IntrospectionInputValue): string {
  const lines: string[] = [];
  const isField = "args" in field;
  lines.push(`field: ${field.name}`);
  lines.push(`  type: ${gqlTypeToString(field.type)}`);
  if (isField && field.description) lines.push(`  description: ${field.description}`);
  if (isField && (field as IntrospectionField).args.length > 0) {
    lines.push("  args:");
    for (const a of (field as IntrospectionField).args) {
      const def = a.defaultValue ? ` (default: ${a.defaultValue})` : "";
      lines.push(`    ${a.name}: ${gqlTypeToString(a.type)}${def}`);
    }
  }
  if (!isField && (field as IntrospectionInputValue).defaultValue) {
    lines.push(`  default: ${(field as IntrospectionInputValue).defaultValue}`);
  }
  if (isField && (field as IntrospectionField).isDeprecated) lines.push("  [deprecated]");
  return lines.join("\n");
}

/** introspection 응답 { __schema: ... } → GqlSpec */
export function parseIntrospection(raw: Record<string, unknown>): GqlSpec {
  const schema = raw["__schema"] as Record<string, unknown>;
  const queryTypeName = (schema["queryType"] as { name: string } | null)?.name ?? "Query";
  const mutationTypeName = (schema["mutationType"] as { name: string } | null)?.name ?? undefined;

  const rawTypes = (schema["types"] ?? []) as IntrospectionType[];
  const types = new Map<string, IntrospectionType>();
  for (const t of rawTypes) {
    if (!t.name.startsWith("__")) types.set(t.name, t);
  }

  const tools: GqlTool[] = [];

  function collectTools(typeName: string, opType: "query" | "mutation") {
    const rootType = types.get(typeName);
    if (!rootType) return;
    for (const field of rootType.fields ?? []) {
      if (field.isDeprecated) continue;
      const inputSchema = field.args.length > 0
        ? buildInputSchema(field.args, types)
        : { type: "object" };
      tools.push({
        name: field.name,
        description: field.description ?? null,
        operationType: opType,
        rootField: field.name,
        args: field.args,
        returnType: field.type,
        inputSchema: inputSchema as Record<string, unknown>,
        autoSelection: autoSelect(field.type, types),
      });
    }
  }

  collectTools(queryTypeName, "query");
  if (mutationTypeName) collectTools(mutationTypeName, "mutation");

  return { queryTypeName, mutationTypeName, types, tools };
}

function buildInputSchema(
  args: IntrospectionInputValue[],
  types: Map<string, IntrospectionType>,
): { type: string; properties: Record<string, unknown>; required?: string[] } {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const arg of args) {
    properties[arg.name] = gqlTypeToJsonSchema(arg.type, types);
    if (arg.type.kind === "NON_NULL") required.push(arg.name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

/** 이름(또는 Mutation./Query. prefix)으로 도구 찾기 */
export function findTool(spec: GqlSpec, name: string): GqlTool | undefined {
  if (name.startsWith("Query.") || name.startsWith("Mutation.")) {
    const dotIdx = name.indexOf(".");
    const prefix = name.slice(0, dotIdx);
    const rootField = name.slice(dotIdx + 1);
    const opType = prefix === "Mutation" ? "mutation" : "query";
    return spec.tools.find((t) => t.rootField === rootField && t.operationType === opType);
  }
  return (
    spec.tools.find((t) => t.rootField === name && t.operationType === "query") ??
    spec.tools.find((t) => t.rootField === name && t.operationType === "mutation")
  );
}
