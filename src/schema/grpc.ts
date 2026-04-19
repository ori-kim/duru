// grpcurl describe 출력 → JSON Schema 변환 — 외부 의존성 없음

const WELL_KNOWN: Record<string, Record<string, unknown>> = {
  "google.protobuf.Timestamp": { type: "string", format: "date-time" },
  "google.protobuf.Duration": { type: "string", pattern: "^-?\\d+(\\.\\d+)?s$" },
  "google.protobuf.FieldMask": { type: "string", description: "comma-separated camelCase field paths" },
  "google.protobuf.Empty": { type: "object" },
  "google.protobuf.Struct": { type: "object" },
  "google.protobuf.Value": { type: "object" },
  "google.protobuf.Any": { type: "object" },
  "google.protobuf.BoolValue": { type: "boolean" },
  "google.protobuf.BytesValue": { type: "string", contentEncoding: "base64" },
  "google.protobuf.StringValue": { type: "string" },
  "google.protobuf.Int32Value": { type: "integer" },
  "google.protobuf.Int64Value": { type: "string" },
  "google.protobuf.UInt32Value": { type: "integer" },
  "google.protobuf.UInt64Value": { type: "string" },
  "google.protobuf.FloatValue": { type: "number" },
  "google.protobuf.DoubleValue": { type: "number" },
  "google.protobuf.ListValue": { type: "array" },
};

const SCALARS: Record<string, Record<string, unknown>> = {
  double: { type: "number" },
  float: { type: "number" },
  int32: { type: "integer" },
  int64: { type: "string" },
  uint32: { type: "integer" },
  uint64: { type: "string" },
  sint32: { type: "integer" },
  sint64: { type: "string" },
  fixed32: { type: "integer" },
  fixed64: { type: "string" },
  sfixed32: { type: "integer" },
  sfixed64: { type: "string" },
  bool: { type: "boolean" },
  string: { type: "string" },
  bytes: { type: "string", contentEncoding: "base64" },
};

const PROTO_KEYWORDS = new Set([
  "message", "enum", "service", "rpc", "syntax", "option",
  "import", "package", "reserved", "extensions", "extend", "oneof",
]);

export type ParsedField = {
  name: string;
  typeName: string;
  repeated: boolean;
  isMap: boolean;
  mapKeyType?: string;
  mapValueType?: string;
  oneofGroup?: string;
};

export type ParsedDescribe =
  | { kind: "message"; fields: ParsedField[] }
  | { kind: "enum"; values: string[] }
  | { kind: "unknown" };

export type ParsedMethod = {
  name: string;
  requestType: string;
  responseType: string;
  clientStreaming: boolean;
  serverStreaming: boolean;
};

/** grpcurl describe <message> 출력 파싱 */
export function parseMessageDescribe(text: string): ParsedDescribe {
  const lines = text.split("\n");
  const header = lines[0] ?? "";

  if (header.includes(" is an enum:")) {
    const values: string[] = [];
    for (const line of lines) {
      const m = line.match(/^\s+([A-Z_][A-Z0-9_]*)\s*=\s*-?\d+\s*;/);
      if (m) values.push(m[1]!);
    }
    return { kind: "enum", values };
  }

  if (!header.includes(" is a message:")) return { kind: "unknown" };

  const fields: ParsedField[] = [];
  let currentOneof: string | undefined;
  let depth = 0;
  let inBody = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!inBody) {
      if (line.endsWith("{")) { inBody = true; depth = 1; }
      continue;
    }

    // map<K, V> field = N;
    const mapM = line.match(/^map<([^,]+),\s*([^>]+)>\s+(\w+)\s*=/);
    if (mapM) {
      fields.push({
        name: mapM[3]!,
        typeName: "map",
        repeated: false,
        isMap: true,
        mapKeyType: mapM[1]!.trim(),
        mapValueType: mapM[2]!.trim().replace(/^\./, ""),
        oneofGroup: currentOneof,
      });
      continue;
    }

    // oneof group {
    const oneofM = line.match(/^oneof\s+(\w+)\s*\{/);
    if (oneofM) { currentOneof = oneofM[1]; depth++; continue; }

    // nested message or enum — skip contents
    if (/^(?:message|enum)\s+\w+\s*\{/.test(line)) { depth++; continue; }

    // closing brace
    if (line === "}" || line === "};") {
      depth--;
      if (depth <= 1 && currentOneof) currentOneof = undefined;
      if (depth <= 0) break;
      continue;
    }

    // repeated type field = N;
    const repM = line.match(/^repeated\s+(\S+)\s+(\w+)\s*=/);
    if (repM) {
      const typeName = repM[1]!.replace(/^\./, "");
      if (!PROTO_KEYWORDS.has(typeName)) {
        fields.push({ name: repM[2]!, typeName, repeated: true, isMap: false, oneofGroup: currentOneof });
      }
      continue;
    }

    // optional/required type field = N; (proto2/proto3 explicit optional)
    const qualM = line.match(/^(?:optional|required)\s+(\S+)\s+(\w+)\s*=/);
    if (qualM) {
      const typeName = qualM[1]!.replace(/^\./, "");
      if (!PROTO_KEYWORDS.has(typeName)) {
        fields.push({ name: qualM[2]!, typeName, repeated: false, isMap: false, oneofGroup: currentOneof });
      }
      continue;
    }

    // type field = N;
    const fieldM = line.match(/^(\S+)\s+(\w+)\s*=\s*\d+\s*;$/);
    if (fieldM && !PROTO_KEYWORDS.has(fieldM[1]!)) {
      fields.push({
        name: fieldM[2]!,
        typeName: fieldM[1]!.replace(/^\./, ""),
        repeated: false,
        isMap: false,
        oneofGroup: currentOneof,
      });
    }
  }

  return { kind: "message", fields };
}

/** grpcurl describe <service> 출력에서 method 시그니처 파싱 */
export function parseServiceDescribe(text: string): ParsedMethod[] {
  const methods: ParsedMethod[] = [];
  for (const line of text.split("\n")) {
    const m = line.trim().match(
      /^rpc\s+(\w+)\s*\(\s*(stream\s+)?([.A-Za-z0-9_]+)\s*\)\s*returns\s*\(\s*(stream\s+)?([.A-Za-z0-9_]+)\s*\)/,
    );
    if (m) {
      methods.push({
        name: m[1]!,
        requestType: m[3]!.replace(/^\./, ""),
        responseType: m[5]!.replace(/^\./, ""),
        clientStreaming: !!m[2],
        serverStreaming: !!m[4],
      });
    }
  }
  return methods;
}

/** 파싱된 타입 → JSON Schema 재귀 변환 (seen으로 순환 참조 방지) */
export function buildJsonSchema(
  typeName: string,
  knownTypes: Map<string, ParsedDescribe>,
  seen: Set<string> = new Set(),
): Record<string, unknown> {
  if (WELL_KNOWN[typeName]) return { ...WELL_KNOWN[typeName]! };
  if (SCALARS[typeName]) return { ...SCALARS[typeName]! };

  const parsed = knownTypes.get(typeName);
  if (!parsed || parsed.kind === "unknown") return {};

  if (parsed.kind === "enum") return { type: "string", enum: parsed.values };

  if (seen.has(typeName)) return { type: "object", description: `recursive: ${typeName}` };

  const nextSeen = new Set(seen).add(typeName);
  const properties: Record<string, unknown> = {};
  const oneofGroups = new Map<string, string[]>();

  for (const field of parsed.fields) {
    let schema: Record<string, unknown>;
    if (field.isMap) {
      const valSchema = buildJsonSchema(field.mapValueType ?? "string", knownTypes, nextSeen);
      const keyType = field.mapKeyType ?? "string";
      schema = {
        type: "object",
        additionalProperties: valSchema,
        ...(keyType !== "string" ? { description: `map key type ${keyType} serialized as string` } : {}),
      };
    } else {
      const inner = buildJsonSchema(field.typeName, knownTypes, nextSeen);
      schema = field.repeated ? { type: "array", items: inner } : inner;
    }
    properties[field.name] = schema;
    if (field.oneofGroup) {
      const g = oneofGroups.get(field.oneofGroup) ?? [];
      g.push(field.name);
      oneofGroups.set(field.oneofGroup, g);
    }
  }

  for (const [group, names] of oneofGroups) {
    for (const fname of names) {
      const s = properties[fname] as Record<string, unknown> | undefined;
      if (s) properties[fname] = { ...s, description: `oneof ${group}: set only one of [${names.join(", ")}]` };
    }
  }

  return { type: "object", properties };
}

export function isWellKnownOrScalar(typeName: string): boolean {
  return typeName in WELL_KNOWN ||
    typeName in SCALARS ||
    typeName.startsWith("google.protobuf.");
}
