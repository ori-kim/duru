import { describe, expect, it } from "bun:test";
import { type SecretProvider, createResolver } from "@duru/secrets";
import { isSecretRef, resolveSecrets } from "./secret-resolution.ts";

function fakeProvider(scheme: string, values: Record<string, string>): SecretProvider {
  const m = new Map(Object.entries(values));
  return {
    scheme,
    async get(p) {
      return m.get(p);
    },
    async set() {},
    async delete() {},
    async list() {
      return [];
    },
  };
}

describe("isSecretRef", () => {
  it("accepts known scheme", () => {
    expect(isSecretRef("keychain://x", ["keychain"])).toBe(true);
  });

  it("rejects literal URL", () => {
    expect(isSecretRef("https://example.com", ["keychain", "https"])).toBe(false);
  });

  it("rejects plain string", () => {
    expect(isSecretRef("just a value", ["keychain"])).toBe(false);
  });

  it("rejects unknown scheme even if not blacklisted", () => {
    expect(isSecretRef("custom://x", ["keychain"])).toBe(false);
  });

  it("rejects non-string", () => {
    expect(isSecretRef(42, ["keychain"])).toBe(false);
  });
});

describe("resolveSecrets", () => {
  it("replaces refs with values in flat record", async () => {
    const resolver = createResolver([fakeProvider("keychain", { "gh/t": "tok" })]);
    const out = await resolveSecrets({ GITHUB_TOKEN: "keychain://gh/t", PLAIN: "literal" }, resolver);
    expect(out).toEqual({ GITHUB_TOKEN: "tok", PLAIN: "literal" });
  });

  it("recurses into nested objects", async () => {
    const resolver = createResolver([fakeProvider("keychain", { token: "tok" })]);
    const out = await resolveSecrets({ headers: { Authorization: "Bearer keychain://token" } }, resolver);
    expect(out).toEqual({ headers: { Authorization: "Bearer keychain://token" } });
    // Note: literal-only resolution. Embedded refs in larger strings stay as-is.
  });

  it("resolves bare string ref inside object", async () => {
    const resolver = createResolver([fakeProvider("keychain", { token: "tok" })]);
    const out = await resolveSecrets({ headers: { Authorization: "keychain://token" } }, resolver);
    expect(out).toEqual({ headers: { Authorization: "tok" } });
  });

  it("walks arrays", async () => {
    const resolver = createResolver([fakeProvider("keychain", { x: "X", y: "Y" })]);
    const out = await resolveSecrets(["keychain://x", "literal", "keychain://y"], resolver);
    expect(out).toEqual(["X", "literal", "Y"]);
  });

  it("leaves non-ref values untouched", async () => {
    const resolver = createResolver([fakeProvider("keychain", {})]);
    expect(await resolveSecrets({ A: "1", B: "hi" }, resolver)).toEqual({
      A: "1",
      B: "hi",
    });
  });

  it("unknown scheme passes through (not detected as ref)", async () => {
    const resolver = createResolver([fakeProvider("keychain", {})]);
    expect(await resolveSecrets({ X: "op://x/y/z" }, resolver)).toEqual({ X: "op://x/y/z" });
  });

  it("resolved value undefined → empty string", async () => {
    const resolver = createResolver([fakeProvider("keychain", {})]);
    expect(await resolveSecrets({ X: "keychain://missing" }, resolver)).toEqual({ X: "" });
  });
});
