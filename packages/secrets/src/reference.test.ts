import { describe, expect, it } from "bun:test";
import { InvalidReference } from "./errors.ts";
import { type SecretRef, isSecretRefString, parseReference } from "./reference.ts";

describe("parseReference", () => {
  it("parses keychain ref", () => {
    expect(parseReference("keychain://gh/TOKEN")).toEqual({
      scheme: "keychain",
      path: "gh/TOKEN",
    } satisfies SecretRef);
  });

  it("parses op ref", () => {
    expect(parseReference("op://Personal/GitHub/token")).toEqual({
      scheme: "op",
      path: "Personal/GitHub/token",
    });
  });

  it("parses file ref with fragment", () => {
    expect(parseReference("file:///etc/secrets.env#DB_PASS")).toEqual({
      scheme: "file",
      path: "/etc/secrets.env#DB_PASS",
    });
  });

  it("rejects empty string", () => {
    expect(() => parseReference("")).toThrow(InvalidReference);
  });

  it("rejects missing scheme", () => {
    expect(() => parseReference("no-scheme")).toThrow(InvalidReference);
  });

  it("rejects invalid scheme chars", () => {
    expect(() => parseReference("BAD!://x")).toThrow(InvalidReference);
  });

  it("accepts scheme with dots/dashes/plus", () => {
    expect(parseReference("aws-sm://prod/db")).toEqual({
      scheme: "aws-sm",
      path: "prod/db",
    });
  });
});

describe("isSecretRefString", () => {
  it("accepts known scheme", () => {
    expect(isSecretRefString("keychain://x", ["keychain"])).toBe(true);
  });

  it("rejects unknown scheme", () => {
    expect(isSecretRefString("ftp://x", ["keychain"])).toBe(false);
  });

  it("rejects blacklisted scheme even if registered", () => {
    expect(isSecretRefString("http://example.com", ["http", "keychain"])).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isSecretRefString(42 as unknown, ["keychain"])).toBe(false);
  });

  it("rejects undefined", () => {
    expect(isSecretRefString(undefined, ["keychain"])).toBe(false);
  });
});
