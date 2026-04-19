import { describe, expect, test } from "bun:test";
import { buildJsonSchema, isWellKnownOrScalar, parseMessageDescribe, parseServiceDescribe } from "./grpc.ts";
import type { ParsedDescribe } from "./grpc.ts";

// --- parseServiceDescribe ---

describe("parseServiceDescribe", () => {
  test("단순 unary RPC 파싱", () => {
    const text = `
grpc.health.v1.Health is a service:
service Health {
  rpc Check ( .grpc.health.v1.HealthCheckRequest ) returns ( .grpc.health.v1.HealthCheckResponse );
  rpc Watch ( .grpc.health.v1.HealthCheckRequest ) returns ( stream .grpc.health.v1.HealthCheckResponse );
}
    `.trim();
    const methods = parseServiceDescribe(text);
    expect(methods).toHaveLength(2);
    expect(methods[0]).toMatchObject({
      name: "Check",
      requestType: "grpc.health.v1.HealthCheckRequest",
      responseType: "grpc.health.v1.HealthCheckResponse",
      clientStreaming: false,
      serverStreaming: false,
    });
    expect(methods[1]).toMatchObject({
      name: "Watch",
      clientStreaming: false,
      serverStreaming: true,
    });
  });

  test("bidi streaming 파싱", () => {
    const text = `
service Chat {
  rpc Stream ( stream .chat.Message ) returns ( stream .chat.Message );
}
    `.trim();
    const [m] = parseServiceDescribe(text);
    expect(m?.clientStreaming).toBe(true);
    expect(m?.serverStreaming).toBe(true);
  });
});

// --- parseMessageDescribe ---

describe("parseMessageDescribe: message", () => {
  const text = `
.petstore.GetPetRequest is a message:
message GetPetRequest {
  int64 id = 1;
  string name = 2;
  bytes photo = 3;
  bool active = 4;
}
  `.trim();

  test("scalar 필드 파싱", () => {
    const result = parseMessageDescribe(text);
    if (result.kind !== "message") throw new Error("expected message");
    expect(result.fields.map((f) => f.name)).toEqual(["id", "name", "photo", "active"]);
    expect(result.fields[0]).toMatchObject({ typeName: "int64", repeated: false, isMap: false });
    expect(result.fields[2]).toMatchObject({ typeName: "bytes" });
  });
});

describe("parseMessageDescribe: repeated", () => {
  const text = `
.pkg.Pets is a message:
message Pets {
  repeated .petstore.Pet pets = 1;
  repeated string tags = 2;
}
  `.trim();

  test("repeated 필드 파싱", () => {
    const result = parseMessageDescribe(text);
    if (result.kind !== "message") throw new Error("expected message");
    expect(result.fields[0]).toMatchObject({ name: "pets", typeName: "petstore.Pet", repeated: true });
    expect(result.fields[1]).toMatchObject({ name: "tags", typeName: "string", repeated: true });
  });
});

describe("parseMessageDescribe: map", () => {
  const text = `
.pkg.MapMsg is a message:
message MapMsg {
  map<string, .pkg.Value> labels = 1;
  map<int32, string> counts = 2;
}
  `.trim();

  test("map 필드 파싱", () => {
    const result = parseMessageDescribe(text);
    if (result.kind !== "message") throw new Error("expected message");
    expect(result.fields[0]).toMatchObject({
      name: "labels",
      isMap: true,
      mapKeyType: "string",
      mapValueType: "pkg.Value",
    });
    expect(result.fields[1]).toMatchObject({
      name: "counts",
      isMap: true,
      mapKeyType: "int32",
      mapValueType: "string",
    });
  });
});

describe("parseMessageDescribe: oneof", () => {
  const text = `
.pkg.Msg is a message:
message Msg {
  oneof payload {
    string text = 1;
    bytes data = 2;
  }
  int32 version = 3;
}
  `.trim();

  test("oneof 필드 그룹 파싱", () => {
    const result = parseMessageDescribe(text);
    if (result.kind !== "message") throw new Error("expected message");
    const text_f = result.fields.find((f) => f.name === "text");
    const data_f = result.fields.find((f) => f.name === "data");
    const version_f = result.fields.find((f) => f.name === "version");
    expect(text_f?.oneofGroup).toBe("payload");
    expect(data_f?.oneofGroup).toBe("payload");
    expect(version_f?.oneofGroup).toBeUndefined();
  });
});

describe("parseMessageDescribe: enum", () => {
  const text = `
.pkg.Status is an enum:
enum Status {
  UNKNOWN = 0;
  ACTIVE = 1;
  INACTIVE = 2;
}
  `.trim();

  test("enum 값 파싱", () => {
    const result = parseMessageDescribe(text);
    expect(result.kind).toBe("enum");
    if (result.kind !== "enum") return;
    expect(result.values).toEqual(["UNKNOWN", "ACTIVE", "INACTIVE"]);
  });
});

describe("parseMessageDescribe: optional/required", () => {
  const text = `
.hello.HelloRequest is a message:
message HelloRequest {
  optional string greeting = 1;
  required int32 version = 2;
}
  `.trim();

  test("optional/required 필드 파싱", () => {
    const result = parseMessageDescribe(text);
    if (result.kind !== "message") throw new Error("expected message");
    expect(result.fields).toHaveLength(2);
    expect(result.fields[0]).toMatchObject({ name: "greeting", typeName: "string", repeated: false });
    expect(result.fields[1]).toMatchObject({ name: "version", typeName: "int32", repeated: false });
  });
});

describe("parseMessageDescribe: unknown", () => {
  test("알 수 없는 출력은 unknown 반환", () => {
    const result = parseMessageDescribe("some random text");
    expect(result.kind).toBe("unknown");
  });
});

// --- buildJsonSchema ---

describe("buildJsonSchema: well-known types", () => {
  const empty = new Map<string, ParsedDescribe>();

  test("Timestamp → date-time string", () => {
    expect(buildJsonSchema("google.protobuf.Timestamp", empty)).toEqual({
      type: "string",
      format: "date-time",
    });
  });

  test("Duration → pattern string", () => {
    const s = buildJsonSchema("google.protobuf.Duration", empty);
    expect(s).toMatchObject({ type: "string" });
    expect((s as Record<string, string>).pattern).toContain("s$");
  });

  test("Empty → empty object", () => {
    expect(buildJsonSchema("google.protobuf.Empty", empty)).toEqual({ type: "object" });
  });

  test("Int32Value → integer", () => {
    expect(buildJsonSchema("google.protobuf.Int32Value", empty)).toEqual({ type: "integer" });
  });

  test("Int64Value → string (JSON 직렬화)", () => {
    expect(buildJsonSchema("google.protobuf.Int64Value", empty)).toEqual({ type: "string" });
  });
});

describe("buildJsonSchema: scalars", () => {
  const empty = new Map<string, ParsedDescribe>();

  test("int64 → string", () => {
    expect(buildJsonSchema("int64", empty)).toEqual({ type: "string" });
  });

  test("bool → boolean", () => {
    expect(buildJsonSchema("bool", empty)).toEqual({ type: "boolean" });
  });

  test("bytes → base64 string", () => {
    expect(buildJsonSchema("bytes", empty)).toEqual({ type: "string", contentEncoding: "base64" });
  });

  test("float → number", () => {
    expect(buildJsonSchema("float", empty)).toEqual({ type: "number" });
  });
});

describe("buildJsonSchema: message 변환", () => {
  test("repeated scalar → array", () => {
    const types = new Map<string, ParsedDescribe>([
      [
        "pkg.Req",
        {
          kind: "message",
          fields: [{ name: "tags", typeName: "string", repeated: true, isMap: false }],
        },
      ],
    ]);
    const schema = buildJsonSchema("pkg.Req", types);
    expect(schema).toMatchObject({
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
    });
  });

  test("map<string,int32> → additionalProperties", () => {
    const types = new Map<string, ParsedDescribe>([
      [
        "pkg.Msg",
        {
          kind: "message",
          fields: [
            {
              name: "counts",
              typeName: "map",
              repeated: false,
              isMap: true,
              mapKeyType: "string",
              mapValueType: "int32",
            },
          ],
        },
      ],
    ]);
    const schema = buildJsonSchema("pkg.Msg", types);
    expect(schema).toMatchObject({
      type: "object",
      properties: {
        counts: {
          type: "object",
          additionalProperties: { type: "integer" },
        },
      },
    });
  });

  test("enum 필드 → type: string, enum 배열", () => {
    const types = new Map<string, ParsedDescribe>([
      ["pkg.Status", { kind: "enum", values: ["UNKNOWN", "ACTIVE"] }],
      [
        "pkg.Msg",
        {
          kind: "message",
          fields: [{ name: "status", typeName: "pkg.Status", repeated: false, isMap: false }],
        },
      ],
    ]);
    const schema = buildJsonSchema("pkg.Msg", types);
    const props = (schema as { properties: Record<string, unknown> }).properties;
    expect(props["status"]).toEqual({ type: "string", enum: ["UNKNOWN", "ACTIVE"] });
  });

  test("순환 참조 방지", () => {
    const types = new Map<string, ParsedDescribe>([
      [
        "pkg.Node",
        {
          kind: "message",
          fields: [
            { name: "value", typeName: "string", repeated: false, isMap: false },
            { name: "child", typeName: "pkg.Node", repeated: false, isMap: false },
          ],
        },
      ],
    ]);
    const schema = buildJsonSchema("pkg.Node", types);
    const props = (schema as { properties: Record<string, unknown> }).properties;
    expect((props["child"] as Record<string, unknown>)["description"]).toContain("recursive");
  });

  test("oneof 필드에 description 추가", () => {
    const types = new Map<string, ParsedDescribe>([
      [
        "pkg.Msg",
        {
          kind: "message",
          fields: [
            { name: "text", typeName: "string", repeated: false, isMap: false, oneofGroup: "payload" },
            { name: "data", typeName: "bytes", repeated: false, isMap: false, oneofGroup: "payload" },
          ],
        },
      ],
    ]);
    const schema = buildJsonSchema("pkg.Msg", types);
    const props = (schema as { properties: Record<string, unknown> }).properties;
    const textDesc = (props["text"] as Record<string, string>)["description"];
    expect(textDesc).toContain("oneof payload");
    expect(textDesc).toContain("text");
    expect(textDesc).toContain("data");
  });
});

// --- isWellKnownOrScalar ---

describe("isWellKnownOrScalar", () => {
  test("Well-known types", () => {
    expect(isWellKnownOrScalar("google.protobuf.Timestamp")).toBe(true);
    expect(isWellKnownOrScalar("google.protobuf.Empty")).toBe(true);
    expect(isWellKnownOrScalar("google.protobuf.CustomNew")).toBe(true); // prefix 체크
  });

  test("scalar types", () => {
    expect(isWellKnownOrScalar("int32")).toBe(true);
    expect(isWellKnownOrScalar("bool")).toBe(true);
    expect(isWellKnownOrScalar("bytes")).toBe(true);
  });

  test("사용자 메시지 타입은 false", () => {
    expect(isWellKnownOrScalar("pkg.MyMessage")).toBe(false);
    expect(isWellKnownOrScalar("MyEnum")).toBe(false);
  });
});
