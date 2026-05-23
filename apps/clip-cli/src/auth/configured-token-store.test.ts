import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OAuthSubject, OAuthToken, OAuthTokenStore } from "@clip/auth";
import { createMemoryGatewayStore } from "@clip/cli-gateway";
import { createFileStore } from "@clip/file-store";
import { createConfiguredOAuthTokenStore } from "./configured-token-store";
import { createTargetFileOAuthTokenStore } from "./file-token-store";

describe("configured OAuth token store", () => {
  test("uses keychain by default when auth.store is omitted", async () => {
    const calls: unknown[] = [];
    const keychain = recordingStore(calls, "keychain");
    const file = recordingStore(calls, "file");
    const targets = createMemoryGatewayStore({
      targets: [
        {
          name: "notes-api",
          type: "api",
          config: { auth: { provider: "test-provider" } },
        },
      ],
    });
    const store = createConfiguredOAuthTokenStore({ targets, keychain, file });

    await store.set(
      { target: "notes-api", provider: "test-provider" },
      { accessToken: "access-token", tokenType: "Bearer" },
    );

    expect(calls).toEqual([
      {
        store: "keychain",
        action: "set",
        subject: { target: "notes-api", provider: "test-provider" },
        token: { accessToken: "access-token", tokenType: "Bearer" },
      },
    ]);
  });

  test("uses target auth.json storage when auth.store is file", async () => {
    const home = await mkdtemp(join(tmpdir(), "clip-configured-auth-store-"));
    const keychainCalls: unknown[] = [];
    const targets = createMemoryGatewayStore({
      targets: [
        {
          name: "notes-api",
          type: "api",
          config: { auth: { provider: "test-provider", store: "file" } },
        },
      ],
    });
    const files = createFileStore({ root: join(home, "gateway") });
    const file = createTargetFileOAuthTokenStore({ files, targets });
    const store = createConfiguredOAuthTokenStore({
      targets,
      keychain: recordingStore(keychainCalls, "keychain"),
      file,
    });

    await store.set(
      { target: "notes-api", provider: "test-provider" },
      { accessToken: "access-token", tokenType: "Bearer" },
    );

    expect(keychainCalls).toEqual([]);
    expect(await readFile(join(home, "gateway", "api", "notes-api", "auth.json"), "utf8")).toContain("access_token");
  });
});

function recordingStore(calls: unknown[], name: string): OAuthTokenStore {
  return {
    async get(subject: OAuthSubject) {
      calls.push({ store: name, action: "get", subject });
      return undefined;
    },
    async set(subject: OAuthSubject, token: OAuthToken) {
      calls.push({ store: name, action: "set", subject, token });
    },
    async delete(subject: OAuthSubject) {
      calls.push({ store: name, action: "delete", subject });
    },
  };
}
