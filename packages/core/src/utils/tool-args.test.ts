import { describe, expect, test } from "bun:test";
import { parseToolArgs } from "./tool-args.ts";

describe("parseToolArgs — individual flags (existing behavior)", () => {
  test("string flag", () => {
    expect(parseToolArgs(["--assignee", "me"], {})).toEqual({ assignee: "me" });
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
