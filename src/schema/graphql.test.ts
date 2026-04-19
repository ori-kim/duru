import { describe, expect, test } from "bun:test";
import {
  type GqlTool,
  type IntrospectionType,
  type IntrospectionTypeRef,
  autoSelect,
  buildOperation,
  describeType,
  findTool,
  gqlTypeToJsonSchema,
  gqlTypeToString,
  parseDotPath,
  parseIntrospection,
} from "./graphql.ts";

// --- 헬퍼 ---

function named(name: string, kind = "SCALAR"): IntrospectionTypeRef {
  return { kind, name, ofType: null };
}
function nonNull(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: "NON_NULL", name: null, ofType: inner };
}
function list(inner: IntrospectionTypeRef): IntrospectionTypeRef {
  return { kind: "LIST", name: null, ofType: inner };
}

// --- gqlTypeToString ---

describe("gqlTypeToString", () => {
  test("named scalar", () => {
    expect(gqlTypeToString(named("String"))).toBe("String");
  });
  test("NON_NULL", () => {
    expect(gqlTypeToString(nonNull(named("Int")))).toBe("Int!");
  });
  test("LIST", () => {
    expect(gqlTypeToString(list(named("String")))).toBe("[String]");
  });
  test("중첩: [Int!]!", () => {
    expect(gqlTypeToString(nonNull(list(nonNull(named("Int")))))).toBe("[Int!]!");
  });
  test("중첩: [[Int!]!]!", () => {
    expect(gqlTypeToString(nonNull(list(nonNull(list(nonNull(named("Int")))))))).toBe("[[Int!]!]!");
  });
});

// --- gqlTypeToJsonSchema ---

describe("gqlTypeToJsonSchema", () => {
  const types = new Map<string, IntrospectionType>();
  types.set("MyEnum", { kind: "ENUM", name: "MyEnum", enumValues: [{ name: "A" }, { name: "B" }] });
  types.set("CustomScalar", { kind: "SCALAR", name: "CustomScalar" });
  types.set("InputObj", {
    kind: "INPUT_OBJECT",
    name: "InputObj",
    inputFields: [
      { name: "id", type: nonNull(named("String")), defaultValue: null },
      { name: "count", type: named("Int"), defaultValue: null },
    ],
  });

  test("Int → integer", () => {
    expect(gqlTypeToJsonSchema(named("Int"), types)).toEqual({ type: "integer" });
  });
  test("Float → number", () => {
    expect(gqlTypeToJsonSchema(named("Float"), types)).toEqual({ type: "number" });
  });
  test("Boolean → boolean", () => {
    expect(gqlTypeToJsonSchema(named("Boolean"), types)).toEqual({ type: "boolean" });
  });
  test("String → string", () => {
    expect(gqlTypeToJsonSchema(named("String"), types)).toEqual({ type: "string" });
  });
  test("ID → string", () => {
    expect(gqlTypeToJsonSchema(named("ID"), types)).toEqual({ type: "string" });
  });
  test("NON_NULL unwrap", () => {
    expect(gqlTypeToJsonSchema(nonNull(named("Int")), types)).toEqual({ type: "integer" });
  });
  test("LIST → array", () => {
    expect(gqlTypeToJsonSchema(list(named("String")), types)).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
  test("ENUM", () => {
    expect(gqlTypeToJsonSchema(named("MyEnum", "ENUM"), types)).toEqual({
      type: "string",
      enum: ["A", "B"],
    });
  });
  test("custom SCALAR → description", () => {
    const s = gqlTypeToJsonSchema(named("CustomScalar", "SCALAR"), types);
    expect(s).toMatchObject({ description: "Custom scalar: CustomScalar" });
  });
  test("INPUT_OBJECT → object with properties and required", () => {
    const schema = gqlTypeToJsonSchema(named("InputObj", "INPUT_OBJECT"), types);
    expect(schema).toEqual({
      type: "object",
      properties: {
        id: { type: "string" },
        count: { type: "integer" },
      },
      required: ["id"],
    });
  });
  test("알 수 없는 타입 → 빈 객체", () => {
    expect(gqlTypeToJsonSchema(named("Unknown", "OBJECT"), types)).toEqual({});
  });
  test("순환 참조 방지", () => {
    const circTypes = new Map(types);
    circTypes.set("Recursive", {
      kind: "INPUT_OBJECT",
      name: "Recursive",
      inputFields: [{ name: "self", type: named("Recursive", "INPUT_OBJECT"), defaultValue: null }],
    });
    const schema = gqlTypeToJsonSchema(named("Recursive", "INPUT_OBJECT"), circTypes);
    expect(schema.type).toBe("object");
    const props = schema.properties as Record<string, unknown>;
    expect((props["self"] as Record<string, unknown>).description).toMatch(/recursive/i);
  });
});

// --- autoSelect ---

describe("autoSelect", () => {
  const types = new Map<string, IntrospectionType>();
  types.set("User", {
    kind: "OBJECT",
    name: "User",
    fields: [
      { name: "id", description: null, args: [], type: nonNull(named("ID")), isDeprecated: false },
      { name: "name", description: null, args: [], type: named("String"), isDeprecated: false },
      { name: "score", description: null, args: [], type: named("Int"), isDeprecated: false },
      { name: "old", description: null, args: [], type: named("String"), isDeprecated: true },
      {
        name: "posts",
        description: null,
        args: [{ name: "limit", type: named("Int"), defaultValue: null }],
        type: list(named("Post")),
        isDeprecated: false,
      },
    ],
  });
  types.set("SearchResult", { kind: "UNION", name: "SearchResult", fields: null });
  types.set("Node", { kind: "INTERFACE", name: "Node", fields: null });

  test("SCALAR 타입 → 빈 문자열 (리프)", () => {
    expect(autoSelect(named("String"), types)).toBe("");
  });
  test("ENUM 타입 → 빈 문자열", () => {
    const enumTypes = new Map(types);
    enumTypes.set("Status", { kind: "ENUM", name: "Status", enumValues: [{ name: "ACTIVE" }] });
    expect(autoSelect(named("Status", "ENUM"), enumTypes)).toBe("");
  });
  test("UNION → { __typename }", () => {
    expect(autoSelect(named("SearchResult", "UNION"), types)).toBe("{ __typename }");
  });
  test("INTERFACE → { __typename }", () => {
    expect(autoSelect(named("Node", "INTERFACE"), types)).toBe("{ __typename }");
  });
  test("OBJECT: deprecated·args 제외, scalar만 선택", () => {
    const sel = autoSelect(named("User", "OBJECT"), types);
    expect(sel).toContain("id");
    expect(sel).toContain("name");
    expect(sel).toContain("score");
    expect(sel).not.toContain("old"); // deprecated
    expect(sel).not.toContain("posts"); // args 있음
  });
  test("NON_NULL 래핑된 타입 처리", () => {
    const sel = autoSelect(nonNull(named("User", "OBJECT")), types);
    expect(sel).toContain("id");
  });
});

// --- parseDotPath ---

describe("parseDotPath", () => {
  test("단일 필드", () => {
    expect(parseDotPath("name")).toBe("{ name }");
  });
  test("복수 필드", () => {
    expect(parseDotPath("name,age")).toBe("{ name age }");
  });
  test("중첩 경로", () => {
    expect(parseDotPath("address.city")).toBe("{ address { city } }");
  });
  test("공유 prefix 병합", () => {
    expect(parseDotPath("address.city,address.country")).toBe("{ address { city country } }");
  });
  test("깊은 중첩", () => {
    expect(parseDotPath("a.b.c,a.b.d")).toBe("{ a { b { c d } } }");
  });
  test("괄호 안 쉼표는 분리하지 않음", () => {
    const result = parseDotPath('repositories(first:5,after:"x").nodes.name');
    expect(result).toBe('{ repositories(first:5,after:"x") { nodes { name } } }');
  });
  test("빈 문자열", () => {
    expect(parseDotPath("")).toBe("");
  });
});

// --- buildOperation ---

const makeTool = (overrides: Partial<GqlTool> = {}): GqlTool => ({
  name: "viewer",
  description: null,
  operationType: "query",
  rootField: "viewer",
  args: [],
  returnType: named("User", "OBJECT"),
  inputSchema: { type: "object" },
  autoSelection: "{ id name }",
  ...overrides,
});

describe("buildOperation", () => {
  test("인자 없음: 선택만", () => {
    const tool = makeTool();
    const op = buildOperation(tool, {}, "{ id name }");
    expect(op).toBe("query q_viewer { viewer { id name } }");
  });

  test("인자 있음: variables-only 정책", () => {
    const tool = makeTool({
      args: [
        { name: "id", type: nonNull(named("String")), defaultValue: null },
        { name: "count", type: named("Int"), defaultValue: null },
      ],
    });
    const op = buildOperation(tool, { id: "123" }, "{ id name }");
    expect(op).toBe("query q_viewer($id: String!) { viewer(id: $id) { id name } }");
    // count 없음 (미전달 인자는 생략)
    expect(op).not.toContain("count");
  });

  test("mutation opName", () => {
    const tool = makeTool({ operationType: "mutation", rootField: "createUser", name: "createUser" });
    const op = buildOperation(tool, {}, "{ id }");
    expect(op).toBe("mutation m_createUser { createUser { id } }");
  });

  test("LIST 인자 타입 문자열", () => {
    const tool = makeTool({
      args: [{ name: "ids", type: nonNull(list(nonNull(named("String")))), defaultValue: null }],
    });
    const op = buildOperation(tool, { ids: ["a", "b"] }, "{ id }");
    expect(op).toBe("query q_viewer($ids: [String!]!) { viewer(ids: $ids) { id } }");
  });

  test("selection 없으면 autoSelection 미포함", () => {
    const tool = makeTool();
    const op = buildOperation(tool, {}, "");
    expect(op).toBe("query q_viewer { viewer }");
  });
});

// --- parseIntrospection ---

const MINIMAL_INTROSPECTION = {
  __schema: {
    queryType: { name: "Query" },
    mutationType: { name: "Mutation" },
    types: [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [
          {
            name: "ping",
            description: "Health check",
            args: [],
            type: nonNull(named("String")),
            isDeprecated: false,
          },
          {
            name: "user",
            description: null,
            args: [{ name: "id", type: nonNull(named("ID")), defaultValue: null }],
            type: named("User", "OBJECT"),
            isDeprecated: false,
          },
        ],
        inputFields: null,
        enumValues: null,
        possibleTypes: null,
      },
      {
        kind: "OBJECT",
        name: "Mutation",
        fields: [
          {
            name: "deleteUser",
            description: null,
            args: [{ name: "id", type: nonNull(named("ID")), defaultValue: null }],
            type: nonNull(named("Boolean")),
            isDeprecated: false,
          },
        ],
        inputFields: null,
        enumValues: null,
        possibleTypes: null,
      },
      {
        kind: "OBJECT",
        name: "User",
        fields: [
          { name: "id", description: null, args: [], type: nonNull(named("ID")), isDeprecated: false },
          { name: "name", description: null, args: [], type: named("String"), isDeprecated: false },
        ],
        inputFields: null,
        enumValues: null,
        possibleTypes: null,
      },
      { kind: "SCALAR", name: "__Schema", fields: null, inputFields: null, enumValues: null, possibleTypes: null },
    ],
  },
};

describe("parseIntrospection", () => {
  const spec = parseIntrospection(MINIMAL_INTROSPECTION);

  test("queryTypeName", () => {
    expect(spec.queryTypeName).toBe("Query");
  });
  test("mutationTypeName", () => {
    expect(spec.mutationTypeName).toBe("Mutation");
  });
  test("__Schema 타입 필터링 (introspection 타입 제외)", () => {
    expect(spec.types.has("__Schema")).toBe(false);
  });
  test("User 타입 포함", () => {
    expect(spec.types.has("User")).toBe(true);
  });
  test("tools: ping + user + deleteUser", () => {
    expect(spec.tools).toHaveLength(3);
  });
  test("ping tool", () => {
    const ping = spec.tools.find((t) => t.rootField === "ping");
    expect(ping).toBeDefined();
    expect(ping!.operationType).toBe("query");
    expect(ping!.description).toBe("Health check");
  });
  test("deleteUser tool operationType", () => {
    const del = spec.tools.find((t) => t.rootField === "deleteUser");
    expect(del?.operationType).toBe("mutation");
  });
  test("user tool inputSchema", () => {
    const user = spec.tools.find((t) => t.rootField === "user");
    expect(user?.inputSchema).toMatchObject({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });
  test("autoSelection: User OBJECT → scalar fields", () => {
    const user = spec.tools.find((t) => t.rootField === "user");
    expect(user?.autoSelection).toContain("id");
    expect(user?.autoSelection).toContain("name");
  });
  test("deprecated tool 제외", () => {
    const types = [
      {
        kind: "OBJECT",
        name: "Query",
        fields: [{ name: "old", description: null, args: [], type: named("String"), isDeprecated: true }],
        inputFields: null,
        enumValues: null,
        possibleTypes: null,
      },
    ];
    const s = parseIntrospection({ __schema: { queryType: { name: "Query" }, mutationType: null, types } });
    expect(s.tools).toHaveLength(0);
  });
});

// --- findTool ---

describe("findTool", () => {
  const spec = parseIntrospection(MINIMAL_INTROSPECTION);

  test("이름으로 찾기 (query 우선)", () => {
    expect(findTool(spec, "ping")?.rootField).toBe("ping");
  });
  test("Query. prefix", () => {
    expect(findTool(spec, "Query.user")?.operationType).toBe("query");
  });
  test("Mutation. prefix", () => {
    expect(findTool(spec, "Mutation.deleteUser")?.operationType).toBe("mutation");
  });
  test("없는 tool → undefined", () => {
    expect(findTool(spec, "nonexistent")).toBeUndefined();
  });
});

// --- describeType ---

describe("describeType", () => {
  test("SCALAR", () => {
    const out = describeType({ kind: "SCALAR", name: "DateTime", description: "ISO 8601" });
    expect(out).toContain("scalar DateTime");
  });
  test("ENUM", () => {
    const out = describeType({
      kind: "ENUM",
      name: "Status",
      enumValues: [{ name: "ACTIVE" }, { name: "INACTIVE" }],
    });
    expect(out).toContain("enum Status");
    expect(out).toContain("ACTIVE");
  });
  test("UNION", () => {
    const out = describeType({
      kind: "UNION",
      name: "SearchResult",
      possibleTypes: [
        { name: "User", kind: "OBJECT" },
        { name: "Post", kind: "OBJECT" },
      ],
    });
    expect(out).toContain("union SearchResult = User | Post");
  });
  test("INPUT_OBJECT", () => {
    const out = describeType({
      kind: "INPUT_OBJECT",
      name: "CreateUserInput",
      inputFields: [
        { name: "name", type: nonNull(named("String")), defaultValue: null },
        { name: "age", type: named("Int"), defaultValue: "18" },
      ],
    });
    expect(out).toContain("input CreateUserInput");
    expect(out).toContain("name: String!");
    expect(out).toContain("age: Int = 18");
  });
  test("OBJECT with args", () => {
    const out = describeType({
      kind: "OBJECT",
      name: "User",
      fields: [
        {
          name: "posts",
          description: null,
          args: [{ name: "limit", type: named("Int"), defaultValue: null }],
          type: list(named("Post")),
          isDeprecated: false,
        },
      ],
    });
    expect(out).toContain("posts(limit: Int): [Post]");
  });
});
