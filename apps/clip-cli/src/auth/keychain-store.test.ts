import { describe, expect, test } from "bun:test";
import { createMacOSKeychainOAuthTokenStore } from "./keychain-store";

describe("macOS keychain OAuth token store", () => {
  test("stores, reads, and deletes OAuth tokens through security commands", async () => {
    const calls: string[][] = [];
    const store = createMacOSKeychainOAuthTokenStore({
      service: "clip.oauth.test",
      async runSecurity(args) {
        calls.push([...args]);
        if (args[0] === "find-generic-password") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ accessToken: "access-token", tokenType: "Bearer" }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    });
    const subject = { target: "notes-api", profile: "dev", provider: "test-provider" };

    await store.set(subject, { accessToken: "access-token", tokenType: "Bearer" });
    const token = await store.get(subject);
    await store.delete(subject);

    expect(token).toEqual({ accessToken: "access-token", tokenType: "Bearer" });
    expect(calls).toEqual([
      [
        "add-generic-password",
        "-U",
        "-s",
        "clip.oauth.test",
        "-a",
        "WyJub3Rlcy1hcGkiLCJkZXYiLCJ0ZXN0LXByb3ZpZGVyIl0",
        "-w",
        JSON.stringify({ accessToken: "access-token", tokenType: "Bearer" }),
      ],
      ["find-generic-password", "-s", "clip.oauth.test", "-a", "WyJub3Rlcy1hcGkiLCJkZXYiLCJ0ZXN0LXByb3ZpZGVyIl0", "-w"],
      ["delete-generic-password", "-s", "clip.oauth.test", "-a", "WyJub3Rlcy1hcGkiLCJkZXYiLCJ0ZXN0LXByb3ZpZGVyIl0"],
    ]);
  });

  test("treats missing keychain entries as empty tokens", async () => {
    const store = createMacOSKeychainOAuthTokenStore({
      async runSecurity() {
        return { exitCode: 44, stdout: "", stderr: "could not be found" };
      },
    });

    await expect(store.get({ target: "notes-api", provider: "test-provider" })).resolves.toBeUndefined();
    await expect(store.delete({ target: "notes-api", provider: "test-provider" })).resolves.toBeUndefined();
  });
});
