import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileProvider, type SecretProvider, createResolver } from "@duru/secrets";
import type { OAuthToken } from "./index.ts";
import type { OAuthBackendConfig } from "./oauth-config.ts";
import { createSecretsOAuthTokenStore } from "./secrets-token-store.ts";

const tmpDirs: string[] = [];
function tmpBaseDir(): string {
  const d = mkdtempSync(join(tmpdir(), "duru-auth-test-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function memoryProvider(scheme: string): {
  provider: SecretProvider;
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  const provider: SecretProvider = {
    scheme,
    async get(p) {
      return store.get(p);
    },
    async set(p, v) {
      store.set(p, v);
    },
    async delete(p) {
      store.delete(p);
    },
    async list() {
      return [...store.keys()];
    },
  };
  return { provider, store };
}

function makeStore(config: Partial<OAuthBackendConfig> = {}, extraSchemes: string[] = []) {
  const { provider: kc, store: kcStore } = memoryProvider("keychain");
  const { provider: op, store: opStore } = memoryProvider("op");
  const providers: SecretProvider[] = [kc, op, new FileProvider({ baseDir: tmpBaseDir() })];
  for (const s of extraSchemes) providers.push(memoryProvider(s).provider);
  const resolver = createResolver(providers);
  const fullConfig: OAuthBackendConfig = {
    provider: config.provider ?? "file",
    targets: config.targets ?? {},
  };
  return {
    store: createSecretsOAuthTokenStore(resolver, fullConfig),
    keychain: kcStore,
    op: opStore,
    resolver,
  };
}

const sampleToken: OAuthToken = { accessToken: "tok", tokenType: "Bearer" };

describe("createSecretsOAuthTokenStore", () => {
  it("uses global oauth.provider when no target override", async () => {
    const { store, keychain } = makeStore({ provider: "keychain", targets: {} });
    await store.set({ target: "gh", provider: "github" }, sampleToken);
    expect(keychain.get("oauth/gh/default/github")).toBe(JSON.stringify(sampleToken));
  });

  it("respects per-target override", async () => {
    const { store, keychain, op } = makeStore({
      provider: "file",
      targets: { gh: { provider: "keychain" } },
    });
    await store.set({ target: "gh", provider: "github" }, sampleToken);
    expect(keychain.get("oauth/gh/default/github")).toBe(JSON.stringify(sampleToken));
    expect(op.size).toBe(0);
  });

  it("handles profile parameter", async () => {
    const { store, keychain } = makeStore({ provider: "keychain", targets: {} });
    await store.set({ target: "gh", profile: "work", provider: "github" }, sampleToken);
    expect(keychain.get("oauth/gh/work/github")).toBe(JSON.stringify(sampleToken));
  });

  it("get returns parsed token", async () => {
    const { store, keychain } = makeStore({ provider: "keychain", targets: {} });
    keychain.set("oauth/gh/default/github", JSON.stringify(sampleToken));
    expect(await store.get({ target: "gh", provider: "github" })).toEqual(sampleToken);
  });

  it("get returns undefined for missing token", async () => {
    const { store } = makeStore({ provider: "keychain", targets: {} });
    expect(await store.get({ target: "missing", provider: "x" })).toBeUndefined();
  });

  it("get returns undefined for invalid JSON", async () => {
    const { store, keychain } = makeStore({ provider: "keychain", targets: {} });
    keychain.set("oauth/gh/default/github", "not json");
    expect(await store.get({ target: "gh", provider: "github" })).toBeUndefined();
  });

  it("delete removes token", async () => {
    const { store, keychain } = makeStore({ provider: "keychain", targets: {} });
    keychain.set("oauth/gh/default/github", JSON.stringify(sampleToken));
    await store.delete({ target: "gh", provider: "github" });
    expect(keychain.has("oauth/gh/default/github")).toBe(false);
  });

  it("falls back to 'file' when no provider configured", async () => {
    const { store, resolver } = makeStore();
    // emptyManifest sets oauth.provider = "file" by default.
    // FileProvider now supports relative-path writes under DURU_HOME/secrets.
    await store.set({ target: "gh", provider: "github" }, sampleToken);
    const fetched = await resolver.resolve("file://oauth/gh/default/github");
    expect(fetched).toBe(JSON.stringify(sampleToken));
  });
});
