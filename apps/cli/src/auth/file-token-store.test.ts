import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryGatewayStore } from "@duru/cli-gateway";
import { createFileStore } from "@duru/file-store";
import { createTargetFileOAuthTokenStore } from "./file-token-store";

describe("target file OAuth token store", () => {
  test("stores OAuth tokens in target auth.json using legacy-compatible field names", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-auth-store-"));
    const targets = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { baseUrl: "https://api.example.com" } }],
    });
    const store = createTargetFileOAuthTokenStore({
      files: createFileStore({ root: join(home, "gateway") }),
      targets,
    });

    await store.set(
      { target: "notes-api", provider: "test-provider" },
      {
        accessToken: "access-token",
        tokenType: "Bearer",
        refreshToken: "refresh-token",
        expiresAt: 1234,
        scope: "items:read",
      },
    );

    const raw = JSON.parse(await readFile(join(home, "gateway", "api", "notes-api", "auth.json"), "utf8"));
    const token = await store.get({ target: "notes-api", provider: "test-provider" });

    expect(raw).toEqual({
      access_token: "access-token",
      token_type: "Bearer",
      refresh_token: "refresh-token",
      expires_at: 1234,
      scope: "items:read",
      provider: "test-provider",
    });
    expect(token).toEqual({
      accessToken: "access-token",
      tokenType: "Bearer",
      refreshToken: "refresh-token",
      expiresAt: 1234,
      scope: "items:read",
    });
  });

  test("stores profile-scoped tokens under target auth directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-auth-profile-store-"));
    const targets = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { baseUrl: "https://api.example.com" } }],
    });
    const store = createTargetFileOAuthTokenStore({
      files: createFileStore({ root: join(home, "gateway") }),
      targets,
    });

    await store.set(
      { target: "notes-api", profile: "dev", provider: "test-provider" },
      { accessToken: "access-token", tokenType: "Bearer" },
    );

    expect(await readFile(join(home, "gateway", "api", "notes-api", "auth", "dev.json"), "utf8")).toContain(
      "access_token",
    );

    await store.delete({ target: "notes-api", profile: "dev", provider: "test-provider" });

    expect(await store.get({ target: "notes-api", profile: "dev", provider: "test-provider" })).toBeUndefined();
  });

  test("reads legacy auth.json files and ignores provider mismatches", async () => {
    const home = await mkdtemp(join(tmpdir(), "duru-auth-legacy-store-"));
    const targets = createMemoryGatewayStore({
      targets: [{ name: "notes-api", type: "api", config: { baseUrl: "https://api.example.com" } }],
    });
    const files = createFileStore({ root: join(home, "gateway") });
    await files.write("api/notes-api/auth.json", {
      access_token: "legacy-token",
      token_type: "Bearer",
      expires_at: 1234,
    });
    const store = createTargetFileOAuthTokenStore({ files, targets });

    expect(await store.get({ target: "notes-api", provider: "test-provider" })).toEqual({
      accessToken: "legacy-token",
      tokenType: "Bearer",
      expiresAt: 1234,
    });

    await files.write("api/notes-api/auth.json", {
      access_token: "other-token",
      token_type: "Bearer",
      provider: "other-provider",
    });

    expect(await store.get({ target: "notes-api", provider: "test-provider" })).toBeUndefined();
  });
});
