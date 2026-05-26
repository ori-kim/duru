import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { type SecretProvider, createResolver, createSecretClient, emptyManifest } from "@duru/secrets";
import { autoInjectDuruEnv } from "./auto-inject.ts";

function makeClient(secrets: Record<string, string>, opts: { enabled?: boolean; prefix?: string } = {}) {
  const store = new Map<string, string>();
  const provider: SecretProvider = {
    scheme: "keychain",
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
  const data = emptyManifest();
  data.secrets = secrets;
  data.autoInject = { enabled: opts.enabled ?? true, prefix: opts.prefix ?? "DURU_" };

  for (const ref of Object.values(secrets)) {
    const path = ref.split("://")[1];
    if (path) store.set(path, `val-${path}`);
  }

  const resolver = createResolver([provider]);
  return createSecretClient({ path: "/m", data }, resolver);
}

const snapshot: Record<string, string | undefined> = {};
const TRACKED_PREFIX = /^(DURU_|MYAPP_)/;

beforeEach(() => {
  for (const k of Object.keys(process.env)) {
    if (TRACKED_PREFIX.test(k)) snapshot[k] = process.env[k];
  }
});
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (TRACKED_PREFIX.test(k)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(snapshot)) {
    if (v !== undefined) process.env[k] = v;
    delete snapshot[k];
  }
});

describe("autoInjectDuruEnv", () => {
  it("injects DURU_* prefixed names into process.env", async () => {
    const client = makeClient({
      DURU_X: "keychain://duru-env/x",
      OTHER: "keychain://other",
    });
    await autoInjectDuruEnv(client);
    expect(process.env.DURU_X).toBe("val-duru-env/x");
    expect(process.env.OTHER).toBeUndefined();
  });

  it("does not overwrite existing process.env", async () => {
    process.env.DURU_X = "already-set";
    const client = makeClient({ DURU_X: "keychain://duru-env/x" });
    await autoInjectDuruEnv(client);
    expect(process.env.DURU_X).toBe("already-set");
  });

  it("respects autoInject.enabled=false", async () => {
    const client = makeClient({ DURU_X: "keychain://duru-env/x" }, { enabled: false });
    await autoInjectDuruEnv(client);
    expect(process.env.DURU_X).toBeUndefined();
  });

  it("custom prefix matching", async () => {
    const client = makeClient({ MYAPP_X: "keychain://my/x", DURU_X: "keychain://d/x" }, { prefix: "MYAPP_" });
    await autoInjectDuruEnv(client);
    expect(process.env.MYAPP_X).toBe("val-my/x");
    expect(process.env.DURU_X).toBeUndefined();
  });
});
