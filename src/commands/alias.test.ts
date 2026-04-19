import { describe, expect, test } from "bun:test";
import { expandArgs, expandInput, flattenInput, resolveAlias } from "./alias.ts";
import type { HasAliases } from "./alias.ts";

// --- expandArgs ---

describe("expandArgs", () => {
  test("no placeholder → auto-appends user args", () => {
    expect(expandArgs(["get", "pods"], ["a", "b"])).toEqual(["get", "pods", "a", "b"]);
  });

  test("no args template → returns user args", () => {
    expect(expandArgs([], ["a", "b"])).toEqual(["a", "b"]);
  });

  test("$1 substitution", () => {
    expect(expandArgs(["--text", "$1"], ["hello"])).toEqual(["--text", "hello"]);
  });

  test("$1 missing → empty string", () => {
    expect(expandArgs(["--text", "$1"], [])).toEqual(["--text", ""]);
  });

  test("$2 substitution", () => {
    expect(expandArgs(["--a", "$1", "--b", "$2"], ["x", "y"])).toEqual(["--a", "x", "--b", "y"]);
  });

  test("$@ spread in middle", () => {
    expect(expandArgs(["--", "$@", "--end"], ["a", "b"])).toEqual(["--", "a", "b", "--end"]);
  });

  test("$@ as sole spread", () => {
    expect(expandArgs(["$@"], ["x", "y", "z"])).toEqual(["x", "y", "z"]);
  });

  test("$@ embedded in text → left as-is (no spread, no auto-append)", () => {
    expect(expandArgs(["prefix-$@"], ["x"])).toEqual(["prefix-$@"]);
  });

  test("$* join to single token", () => {
    expect(expandArgs(["$*"], ["a", "b c"])).toEqual(["a b c"]);
  });

  test("$$ escape → literal $", () => {
    expect(expandArgs(["cost-$$"], [])).toEqual(["cost-$"]);
  });

  test("${VAR} env substitution", () => {
    expect(expandArgs(["val=${MY_VAR}"], [], { MY_VAR: "world" })).toEqual(["val=world"]);
  });

  test("positional placeholder present → no auto-append", () => {
    expect(expandArgs(["--text", "$1"], ["hello", "extra"])).toEqual(["--text", "hello"]);
  });
});

// --- expandInput ---

describe("expandInput", () => {
  test("plain string passthrough", () => {
    expect(expandInput({ channel: "U123" }, [])).toEqual({ channel: "U123" });
  });

  test("$1 string substitution", () => {
    expect(expandInput({ text: "$1" }, ["hello"])).toEqual({ text: "hello" });
  });

  test("pure $1 token preserves number type", () => {
    expect(expandInput({ limit: "$1" }, ["42"])).toEqual({ limit: 42 });
  });

  test("pure $1 token preserves bool type", () => {
    expect(expandInput({ flag: "$1" }, ["true"])).toEqual({ flag: true });
  });

  test("pure $1 missing → empty string", () => {
    expect(expandInput({ text: "$1" }, [])).toEqual({ text: "" });
  });

  test("non-string value passthrough", () => {
    expect(expandInput({ count: 5, flag: true }, [])).toEqual({ count: 5, flag: true });
  });

  test("${VAR} in value", () => {
    expect(expandInput({ url: "http://${HOST}" }, [], { HOST: "example.com" })).toEqual({
      url: "http://example.com",
    });
  });
});

// --- flattenInput ---

describe("flattenInput", () => {
  test("string values", () => {
    expect(flattenInput({ channel: "U123", text: "hello" })).toEqual(["--channel", "U123", "--text", "hello"]);
  });

  test("non-string values → JSON", () => {
    expect(flattenInput({ count: 5, flag: true })).toEqual(["--count", "5", "--flag", "true"]);
  });

  test("object value → JSON stringify", () => {
    const result = flattenInput({ nested: { a: 1 } });
    expect(result[0]).toBe("--nested");
    expect(JSON.parse(result[1]!)).toEqual({ a: 1 });
  });
});

// --- resolveAlias ---

describe("resolveAlias", () => {
  const target: HasAliases = {
    aliases: {
      "send-me": {
        subcommand: "chat.postMessage",
        input: { channel: "U123", text: "$1" },
      },
      "pods-dev": {
        subcommand: "get",
        args: ["pods", "-n", "dev"],
      },
      pass: {
        subcommand: "echo",
      },
    },
  };

  test("no matching alias → null", () => {
    expect(resolveAlias(target, "unknown", [])).toBeNull();
  });

  test("alias with input → flattened args", () => {
    const r = resolveAlias(target, "send-me", ["hello"]);
    expect(r).not.toBeNull();
    expect(r!.subcommand).toBe("chat.postMessage");
    expect(r!.args).toEqual(["--channel", "U123", "--text", "hello"]);
    expect(r!.hasInput).toBe(true);
  });

  test("alias with args → expanded", () => {
    const r = resolveAlias(target, "pods-dev", []);
    expect(r).not.toBeNull();
    expect(r!.subcommand).toBe("get");
    expect(r!.args).toEqual(["pods", "-n", "dev"]);
  });

  test("alias with no args/input → passes user args through", () => {
    const r = resolveAlias(target, "pass", ["a", "b"]);
    expect(r!.args).toEqual(["a", "b"]);
  });

  test("resolves scriptName", () => {
    const r = resolveAlias(target, "send-me", ["hi"]);
    expect(r!.scriptName).toBe("send-me");
  });

  test("empty aliases record → null", () => {
    expect(resolveAlias({}, "anything", [])).toBeNull();
  });
});
