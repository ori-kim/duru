import { describe, expect, test } from "bun:test";
import { applyTargetEnv, interpolate, parseDotenv } from "./env-interpolation";

describe("parseDotenv", () => {
  test("parses basic key=value lines", () => {
    expect(parseDotenv("FOO=bar")).toEqual(new Map([["FOO", "bar"]]));
    expect(parseDotenv("FOO=bar\nBAZ=qux")).toEqual(
      new Map([
        ["FOO", "bar"],
        ["BAZ", "qux"],
      ]),
    );
  });

  test("handles double-quoted values with escapes", () => {
    expect(parseDotenv('FOO="bar baz"')).toEqual(new Map([["FOO", "bar baz"]]));
    expect(parseDotenv('FOO="line\\nbreak"')).toEqual(new Map([["FOO", "line\nbreak"]]));
    expect(parseDotenv('FOO="quote\\"inside"')).toEqual(new Map([["FOO", 'quote"inside']]));
  });

  test("handles single-quoted values without escape processing", () => {
    expect(parseDotenv("FOO='bar baz'")).toEqual(new Map([["FOO", "bar baz"]]));
    expect(parseDotenv("FOO='line\\nbreak'")).toEqual(new Map([["FOO", "line\\nbreak"]]));
  });

  test("skips comments, blank lines, and export prefix", () => {
    const text = ["# comment", "", "export FOO=bar", "  ", "# another", "BAZ=qux"].join("\n");
    expect(parseDotenv(text)).toEqual(
      new Map([
        ["FOO", "bar"],
        ["BAZ", "qux"],
      ]),
    );
  });

  test("strips trailing inline comments from unquoted values", () => {
    expect(parseDotenv("FOO=bar # trailing")).toEqual(new Map([["FOO", "bar"]]));
  });

  test("supports empty values and ignores malformed lines", () => {
    expect(parseDotenv("FOO=")).toEqual(new Map([["FOO", ""]]));
    expect(parseDotenv("no equals sign")).toEqual(new Map());
    expect(parseDotenv("=valueOnly")).toEqual(new Map());
    expect(parseDotenv("1BAD=foo")).toEqual(new Map());
  });
});

describe("interpolate", () => {
  test("substitutes ${VAR} in plain strings", () => {
    expect(interpolate("Bearer ${TOKEN}", new Map([["TOKEN", "abc"]]))).toBe("Bearer abc");
    expect(
      interpolate(
        "${A}-${B}",
        new Map([
          ["A", "1"],
          ["B", "2"],
        ]),
      ),
    ).toBe("1-2");
  });

  test("returns empty string for missing variables", () => {
    expect(interpolate("Bearer ${MISSING}", new Map())).toBe("Bearer ");
    expect(interpolate("${A}/${B}", new Map([["A", "x"]]))).toBe("x/");
  });

  test("escapes $${VAR} to literal ${VAR}", () => {
    expect(interpolate("foo $${VAR} bar", new Map([["VAR", "value"]]))).toBe("foo ${VAR} bar");
  });

  test("walks objects and arrays recursively, preserving non-strings", () => {
    const env = new Map([
      ["X", "1"],
      ["Y", "2"],
    ]);
    expect(
      interpolate(
        {
          url: "https://example.com/${X}",
          headers: { Authorization: "Bearer ${Y}", count: 7, enabled: true },
          tags: ["${X}", 42, null],
          meta: undefined,
        },
        env,
      ),
    ).toEqual({
      url: "https://example.com/1",
      headers: { Authorization: "Bearer 2", count: 7, enabled: true },
      tags: ["1", 42, null],
      meta: undefined,
    });
  });

  test("returns primitives unchanged", () => {
    const env = new Map<string, string>();
    expect(interpolate(42, env)).toBe(42);
    expect(interpolate(true, env)).toBe(true);
    expect(interpolate(null, env)).toBe(null);
    expect(interpolate(undefined, env)).toBe(undefined);
  });
});

describe("applyTargetEnv", () => {
  test("loads env from services.env and interpolates config", async () => {
    const calls: Array<{ target: string; type: string }> = [];
    const config = { headers: { Authorization: "Bearer ${TOKEN}" } };
    const result = await applyTargetEnv(config, {
      manifest: { name: "slack", type: "mcp" },
      options: {
        services: {
          env: {
            async loadTargetEnv(input) {
              calls.push(input);
              return new Map([["TOKEN", "abc"]]);
            },
          },
        },
      },
    });
    expect(result).toEqual({ headers: { Authorization: "Bearer abc" } });
    expect(calls).toEqual([{ target: "slack", type: "mcp" }]);
  });

  test("interpolates with empty env when service is absent", async () => {
    const config = { headers: { Authorization: "Bearer ${TOKEN}" } };
    const result = await applyTargetEnv(config, {
      manifest: { name: "slack", type: "mcp" },
      options: {},
    });
    expect(result).toEqual({ headers: { Authorization: "Bearer " } });
  });
});
