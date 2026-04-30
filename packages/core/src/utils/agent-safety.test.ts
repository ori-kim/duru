import { describe, expect, test } from "bun:test";
import { hardenAgentInput, validateIdentifier } from "./agent-safety.ts";

describe("agent input hardening", () => {
  test("rejects invalid identifiers", () => {
    expect(() => validateIdentifier("../target", "Target name")).toThrow(
      "Target name may only contain letters, digits, _ and -",
    );
    expect(() => validateIdentifier("ok_name-1", "Target name")).not.toThrow();
  });

  test("rejects dangerous control characters in strings", () => {
    expect(() => hardenAgentInput({ title: "hello\u0000world" })).toThrow("control characters");
  });

  test("allows normal multiline text", () => {
    expect(() => hardenAgentInput({ body: "line one\nline two" })).not.toThrow();
  });

  test("rejects query fragments and pre-encoding in resource identifiers", () => {
    expect(() => hardenAgentInput({ fileId: "abc?fields=name" })).toThrow("resource identifiers");
    expect(() => hardenAgentInput({ page_id: "abc#section" })).toThrow("resource identifiers");
    expect(() => hardenAgentInput({ resourceName: "%2e%2e" })).toThrow("resource identifiers");
  });

  test("rejects unsafe output paths", () => {
    expect(() => hardenAgentInput({ outputDir: "../secret" })).toThrow("output paths");
    expect(() => hardenAgentInput({ output_file: "/tmp/out.txt" })).toThrow("output paths");
  });
});
