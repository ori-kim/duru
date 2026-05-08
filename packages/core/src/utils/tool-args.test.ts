import { describe, expect, test } from "bun:test";
import { formatToolHelp, parseToolArgs } from "./tool-args.ts";

describe("parseToolArgs — individual flags (existing behavior)", () => {
  test("string flag", () => {
    expect(parseToolArgs(["--assignee", "me"], {})).toEqual({ assignee: "me" });
  });

  test("schema string flag preserves JSON-looking values", () => {
    const schema = { properties: { operations: { type: "string" } } };
    expect(parseToolArgs(["--operations", "[]"], schema)).toEqual({ operations: "[]" });
  });

  test("boolean flag without value", () => {
    expect(parseToolArgs(["--verbose"], {})).toEqual({ verbose: true });
  });

  test("number coercion via schema", () => {
    const schema = { properties: { limit: { type: "number" } } };
    expect(parseToolArgs(["--limit", "10"], schema)).toEqual({ limit: 10 });
  });

  test("key=value syntax", () => {
    expect(parseToolArgs(["assignee=me"], {})).toEqual({ assignee: "me" });
  });

  test("--key=value syntax", () => {
    expect(parseToolArgs(["--limit=10"], {})).toEqual({ limit: 10 });
  });

  test("repeated array flags accumulate values", () => {
    const schema = { properties: { files: { type: "array", items: { type: "string" } } } };
    expect(parseToolArgs(["--files", "./a.pdf", "--files", "./b.pdf"], schema)).toEqual({
      files: ["./a.pdf", "./b.pdf"],
    });
  });

  test("array flag also accepts JSON array values", () => {
    const schema = { properties: { ids: { type: "array", items: { type: "integer" } } } };
    expect(parseToolArgs(["--ids", "[1,2]"], schema)).toEqual({ ids: [1, 2] });
  });
});

describe("parseToolArgs — --args spread (new behavior)", () => {
  test("spreads JSON object to top-level", () => {
    expect(parseToolArgs(["--args", '{"a":1,"b":2}'], {})).toEqual({ a: 1, b: 2 });
  });

  test("individual flag complements --args", () => {
    // "2" has no schema → JSON.parse("2") = 2 (number), same as existing behavior
    expect(parseToolArgs(["--args", '{"a":1}', "--b", "2"], {})).toEqual({ a: 1, b: 2 });
  });

  test("individual flag overrides --args (flag after)", () => {
    expect(parseToolArgs(["--args", '{"a":1}', "--a", "2"], {})).toEqual({ a: 2 });
  });

  test("individual flag overrides --args (flag before)", () => {
    expect(parseToolArgs(["--a", "2", "--args", '{"a":1}'], {})).toEqual({ a: 2 });
  });

  test("multiple --args are merged (later wins on same key)", () => {
    expect(parseToolArgs(["--args", '{"a":1}', "--args", '{"b":2}'], {})).toEqual({ a: 1, b: 2 });
  });

  test("multiple --args same key: later wins", () => {
    expect(parseToolArgs(["--args", '{"a":1}', "--args", '{"a":2}'], {})).toEqual({ a: 2 });
  });

  test("JSON number preserved without coercion", () => {
    const schema = { properties: { limit: { type: "number" } } };
    expect(parseToolArgs(["--args", '{"limit":10}'], schema)).toEqual({ limit: 10 });
  });

  test("JSON boolean preserved", () => {
    expect(parseToolArgs(["--args", '{"active":true}'], {})).toEqual({ active: true });
  });

  test("--args=value inline syntax", () => {
    expect(parseToolArgs(['--args={"x":1}'], {})).toEqual({ x: 1 });
  });
});

describe("parseToolArgs — --args error cases", () => {
  test("invalid JSON throws with message", () => {
    expect(() => parseToolArgs(["--args", "not-json"], {})).toThrow("Invalid JSON in --args");
  });

  test("JSON array throws", () => {
    expect(() => parseToolArgs(["--args", "[1,2,3]"], {})).toThrow("--args must be a plain JSON object");
  });

  test("JSON null throws", () => {
    expect(() => parseToolArgs(["--args", "null"], {})).toThrow("--args must be a plain JSON object");
  });

  test("JSON string throws", () => {
    expect(() => parseToolArgs(["--args", '"hello"'], {})).toThrow("--args must be a plain JSON object");
  });

  test("JSON number throws", () => {
    expect(() => parseToolArgs(["--args", "42"], {})).toThrow("--args must be a plain JSON object");
  });

  test("--args without value throws", () => {
    expect(() => parseToolArgs(["--other", "val", "--args"], {})).toThrow("--args requires a JSON object value");
  });

  test("--args followed by another flag (no value) throws", () => {
    expect(() => parseToolArgs(["--args", "--other"], {})).toThrow("--args requires a JSON object value");
  });
});

describe("parseToolArgs — --args escape hatch (schema defines 'args' key)", () => {
  const schema = { properties: { args: { type: "string" } } };

  test("nested as-is when schema defines args", () => {
    expect(parseToolArgs(["--args", "hello"], schema)).toEqual({ args: "hello" });
  });

  test("no spread when schema defines args — JSON string stays as string", () => {
    expect(parseToolArgs(["--args", '{"x":1}'], schema)).toEqual({ args: '{"x":1}' });
  });
});

describe("parseToolArgs — regression: --params not spread (nested as before)", () => {
  test("--params keeps nested behavior", () => {
    expect(parseToolArgs(["--params", '{"assignee":"me"}'], {})).toEqual({
      params: { assignee: "me" },
    });
  });
});

describe("parseToolArgs — agent input hardening", () => {
  test("rejects control characters", () => {
    expect(() => parseToolArgs(["--title", "hello\u0000world"], {})).toThrow("control characters");
  });

  test("rejects query params in resource ids", () => {
    const schema = { properties: { fileId: { type: "string" } } };
    expect(() => parseToolArgs(["--fileId", "abc?fields=name"], schema)).toThrow("resource identifiers");
  });

  test("rejects pre-encoded resource ids from --args", () => {
    expect(() => parseToolArgs(["--args", '{"page_id":"%2e%2e"}'], {})).toThrow("resource identifiers");
  });
});

describe("parseToolArgs — schema validation", () => {
  test("rejects missing required arguments", () => {
    const schema = { required: ["limit"], properties: { limit: { type: "number" } } };
    expect(() => parseToolArgs([], schema)).toThrow("Missing required argument: args.limit");
  });

  test("accepts injected default arguments as schema inputs", () => {
    const schema = { required: ["token"], properties: { token: { type: "string" } } };
    expect(parseToolArgs([], schema, { token: "dummy-injected-token" })).toEqual({ token: "dummy-injected-token" });
  });

  test("explicit flags override injected default arguments", () => {
    const schema = { required: ["token"], properties: { token: { type: "string" } } };
    expect(parseToolArgs(["--token", "dummy-manual-token"], schema, { token: "dummy-injected-token" })).toEqual({
      token: "dummy-manual-token",
    });
  });

  test("rejects invalid integer values", () => {
    const schema = { properties: { limit: { type: "integer" } } };
    expect(() => parseToolArgs(["--limit", "1.5"], schema)).toThrow('Invalid --limit: expected integer, got "1.5"');
  });

  test("rejects invalid boolean values", () => {
    const schema = { properties: { active: { type: "boolean" } } };
    expect(() => parseToolArgs(["--active", "yes"], schema)).toThrow('Invalid --active: expected boolean, got "yes"');
  });

  test("rejects invalid object JSON", () => {
    const schema = { properties: { payload: { type: "object" } } };
    expect(() => parseToolArgs(["--payload", "not-json"], schema)).toThrow("Invalid JSON for --payload");
  });

  test("rejects enum values outside the schema", () => {
    const schema = { properties: { state: { enum: ["open", "closed"] } } };
    expect(() => parseToolArgs(["--state", "maybe"], schema)).toThrow(
      'Invalid args.state: expected one of "open", "closed"',
    );
  });

  test("rejects unknown arguments when additionalProperties is false", () => {
    const schema = { additionalProperties: false, properties: { title: { type: "string" } } };
    expect(() => parseToolArgs(["--title", "ok", "--extra", "nope"], schema)).toThrow("Unknown argument: args.extra");
  });

  test("validates --args JSON without string coercion", () => {
    const schema = { properties: { limit: { type: "number" } } };
    expect(() => parseToolArgs(["--args", '{"limit":"10"}'], schema)).toThrow(
      "Invalid args.limit: expected number, got string",
    );
  });

  test("validates nested array items", () => {
    const schema = {
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
        },
      },
    };

    expect(() => parseToolArgs(["--ids", "[1,2.5]"], schema)).toThrow(
      "Invalid args.ids[1]: expected integer, got number",
    );
  });
});

describe("formatToolHelp — injected arguments", () => {
  test("does not mark injected required arguments as manually required", () => {
    const result = formatToolHelp(
      {
        name: "call",
        description: "Test call",
        inputSchema: {
          required: ["token"],
          properties: { token: { type: "string" } },
        },
      },
      { token: "dummy-injected-token" },
    );

    expect(result.stdout).toContain("--token");
    expect(result.stdout).toContain("[injected]");
    expect(result.stdout).not.toContain("--token                  string (required)");
  });
});
