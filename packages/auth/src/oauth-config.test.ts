import { describe, expect, it } from "bun:test";
import { emptyManifest } from "@duru/secrets";
import { parseOAuthBackendConfig } from "./oauth-config.ts";

describe("parseOAuthBackendConfig", () => {
  it("defaults to file provider when extensions.oauth missing", () => {
    expect(parseOAuthBackendConfig(emptyManifest())).toEqual({
      provider: "file",
      targets: {},
    });
  });

  it("reads provider + targets from extensions.oauth", () => {
    const data = emptyManifest();
    data.extensions = {
      oauth: {
        provider: "keychain",
        targets: { gh: { provider: "op" } },
      },
    };
    expect(parseOAuthBackendConfig(data)).toEqual({
      provider: "keychain",
      targets: { gh: { provider: "op" } },
    });
  });

  it("defaults provider to file when only targets present", () => {
    const data = emptyManifest();
    data.extensions = { oauth: { targets: { gh: { provider: "keychain" } } } };
    expect(parseOAuthBackendConfig(data)).toEqual({
      provider: "file",
      targets: { gh: { provider: "keychain" } },
    });
  });

  it("rejects non-object oauth slot", () => {
    const data = emptyManifest();
    data.extensions = { oauth: "wrong" };
    expect(() => parseOAuthBackendConfig(data)).toThrow();
  });

  it("rejects bad provider scheme", () => {
    const data = emptyManifest();
    data.extensions = { oauth: { provider: "BAD!" } };
    expect(() => parseOAuthBackendConfig(data)).toThrow();
  });

  it("rejects bad target provider", () => {
    const data = emptyManifest();
    data.extensions = {
      oauth: { provider: "file", targets: { gh: { provider: "BAD!" } } },
    };
    expect(() => parseOAuthBackendConfig(data)).toThrow();
  });

  it("rejects non-object targets[name]", () => {
    const data = emptyManifest();
    data.extensions = { oauth: { provider: "file", targets: { gh: "wrong" } } };
    expect(() => parseOAuthBackendConfig(data)).toThrow();
  });
});
