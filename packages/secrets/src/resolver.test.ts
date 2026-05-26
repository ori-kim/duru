import { describe, expect, it, mock } from "bun:test";
import { ProviderUnavailable } from "./errors.ts";
import type { SecretProvider } from "./provider.ts";
import { createResolver } from "./resolver.ts";

function fakeProvider(scheme: string, values: Record<string, string> = {}): SecretProvider {
  const store = new Map(Object.entries(values));
  return {
    scheme,
    async get(path) {
      return store.get(path);
    },
    async set(path, v) {
      store.set(path, v);
    },
    async delete(path) {
      store.delete(path);
    },
    async list(prefix) {
      const keys = [...store.keys()];
      return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    },
  };
}

describe("SecretResolver.resolve", () => {
  it("routes by scheme", async () => {
    const resolver = createResolver([
      fakeProvider("keychain", { "gh/TOKEN": "ghtok" }),
      fakeProvider("op", { "Personal/GH/t": "optok" }),
    ]);
    expect(await resolver.resolve("keychain://gh/TOKEN")).toBe("ghtok");
    expect(await resolver.resolve("op://Personal/GH/t")).toBe("optok");
  });

  it("returns undefined for missing path", async () => {
    const resolver = createResolver([fakeProvider("keychain")]);
    expect(await resolver.resolve("keychain://missing")).toBeUndefined();
  });

  it("throws ProviderUnavailable for unregistered scheme", async () => {
    const resolver = createResolver([fakeProvider("keychain")]);
    await expect(resolver.resolve("op://x")).rejects.toThrow(ProviderUnavailable);
  });

  it("accepts SecretRef object", async () => {
    const resolver = createResolver([fakeProvider("keychain", { x: "v" })]);
    expect(await resolver.resolve({ scheme: "keychain", path: "x" })).toBe("v");
  });

  it("rejects duplicate provider schemes at creation", () => {
    expect(() => createResolver([fakeProvider("keychain"), fakeProvider("keychain")])).toThrow();
  });
});

describe("SecretResolver memoization", () => {
  it("memoizes within single resolve session", async () => {
    const provider = fakeProvider("keychain", { x: "v" });
    const spy = mock(provider.get.bind(provider));
    provider.get = spy as typeof provider.get;
    const resolver = createResolver([provider]);

    await resolver.resolve("keychain://x");
    await resolver.resolve("keychain://x");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("clearCache forces re-fetch", async () => {
    const provider = fakeProvider("keychain", { x: "v" });
    const spy = mock(provider.get.bind(provider));
    provider.get = spy as typeof provider.get;
    const resolver = createResolver([provider]);

    await resolver.resolve("keychain://x");
    resolver.clearCache();
    await resolver.resolve("keychain://x");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("store invalidates cache entry", async () => {
    const provider = fakeProvider("keychain", { x: "old" });
    const resolver = createResolver([provider]);
    expect(await resolver.resolve("keychain://x")).toBe("old");
    await resolver.store("keychain://x", "new");
    expect(await resolver.resolve("keychain://x")).toBe("new");
  });
});

describe("SecretResolver.store / remove / list", () => {
  it("delegates store to provider.set", async () => {
    const provider = fakeProvider("keychain");
    const resolver = createResolver([provider]);
    await resolver.store("keychain://x", "v");
    expect(await provider.get("x")).toBe("v");
  });

  it("delegates remove to provider.delete", async () => {
    const provider = fakeProvider("keychain", { x: "v" });
    const resolver = createResolver([provider]);
    await resolver.remove("keychain://x");
    expect(await provider.get("x")).toBeUndefined();
  });

  it("list by scheme + optional prefix", async () => {
    const provider = fakeProvider("keychain", {
      "gh/t": "1",
      "gh/u": "2",
      "aws/k": "3",
    });
    const resolver = createResolver([provider]);
    expect((await resolver.list("keychain", "gh/")).sort()).toEqual(["gh/t", "gh/u"]);
    expect((await resolver.list("keychain")).sort()).toEqual(["aws/k", "gh/t", "gh/u"]);
  });

  it("list throws for unregistered scheme", async () => {
    const resolver = createResolver([fakeProvider("keychain")]);
    await expect(resolver.list("op")).rejects.toThrow(ProviderUnavailable);
  });

  it("schemes exposes registered scheme names", () => {
    const resolver = createResolver([fakeProvider("keychain"), fakeProvider("op")]);
    expect([...resolver.schemes].sort()).toEqual(["keychain", "op"]);
  });
});
