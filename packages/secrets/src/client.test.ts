import { describe, expect, it } from "bun:test";
import { createSecretClient } from "./client.ts";
import { SecretNotFound } from "./errors.ts";
import { type Manifest, emptyManifest } from "./manifest.ts";
import type { SecretProvider } from "./provider.ts";
import { createResolver } from "./resolver.ts";

function fakeProvider(values: Record<string, string> = {}): SecretProvider {
  const store = new Map(Object.entries(values));
  return {
    scheme: "keychain",
    async get(path) {
      return store.get(path);
    },
    async set(path, v) {
      store.set(path, v);
    },
    async delete(path) {
      store.delete(path);
    },
    async list() {
      return [...store.keys()];
    },
  };
}

function manifestWith(secrets: Record<string, string>): Manifest {
  return {
    path: "/test/manifest.json",
    data: { ...emptyManifest(), secrets },
  };
}

describe("SecretClient.get", () => {
  it("resolves name → ref via manifest, then to value", async () => {
    const resolver = createResolver([fakeProvider({ "gh/t": "ghtok" })]);
    const client = createSecretClient(manifestWith({ GH_TOKEN: "keychain://gh/t" }), resolver);
    expect(await client.get("GH_TOKEN")).toBe("ghtok");
  });

  it("throws SecretNotFound when name not in manifest", async () => {
    const client = createSecretClient(manifestWith({}), createResolver([fakeProvider()]));
    await expect(client.get("MISSING")).rejects.toThrow(SecretNotFound);
  });

  it("throws SecretNotFound when value missing in backend", async () => {
    const resolver = createResolver([fakeProvider()]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    await expect(client.get("X")).rejects.toThrow(SecretNotFound);
  });
});

describe("SecretClient.getOptional", () => {
  it("returns string when present", async () => {
    const resolver = createResolver([fakeProvider({ x: "v" })]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    expect(await client.getOptional("X")).toBe("v");
  });

  it("returns undefined when name missing", async () => {
    const client = createSecretClient(manifestWith({}), createResolver([fakeProvider()]));
    expect(await client.getOptional("MISSING")).toBeUndefined();
  });

  it("returns undefined when backend missing", async () => {
    const resolver = createResolver([fakeProvider()]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    expect(await client.getOptional("X")).toBeUndefined();
  });
});

describe("SecretClient.store / remove", () => {
  it("store updates backend via ref", async () => {
    const provider = fakeProvider();
    const resolver = createResolver([provider]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    await client.store("X", "new-value");
    expect(await provider.get("x")).toBe("new-value");
  });

  it("remove deletes from backend", async () => {
    const provider = fakeProvider({ x: "v" });
    const resolver = createResolver([provider]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    await client.remove("X");
    expect(await provider.get("x")).toBeUndefined();
  });
});

describe("SecretClient.list / resolveRef / manifest", () => {
  it("list returns manifest secret names", () => {
    const client = createSecretClient(
      manifestWith({ A: "keychain://a", B: "keychain://b" }),
      createResolver([fakeProvider()]),
    );
    expect([...client.list()].sort()).toEqual(["A", "B"]);
  });

  it("resolveRef returns SecretRef for known name", () => {
    const client = createSecretClient(manifestWith({ X: "keychain://x/y" }), createResolver([fakeProvider()]));
    expect(client.resolveRef("X")).toEqual({ scheme: "keychain", path: "x/y" });
  });

  it("resolveRef returns undefined for unknown", () => {
    const client = createSecretClient(manifestWith({}), createResolver([fakeProvider()]));
    expect(client.resolveRef("missing")).toBeUndefined();
  });

  it("manifest() returns current manifest", () => {
    const m = manifestWith({ X: "keychain://x" });
    const client = createSecretClient(m, createResolver([fakeProvider()]));
    expect(client.manifest()).toBe(m);
  });
});

describe("SecretClient.typed — TS narrowing", () => {
  it("get narrows to literal type from const array", async () => {
    const resolver = createResolver([fakeProvider({ x: "v" })]);
    const client = createSecretClient(manifestWith({ X: "keychain://x" }), resolver);
    const typed = client.typed(["X"] as const);

    // @ts-expect-error — "Y" not in const list
    await typed.getOptional("Y").catch(() => undefined);

    const ok: string = await typed.get("X");
    expect(ok).toBe("v");
  });
});
