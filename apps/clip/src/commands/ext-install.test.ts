import { describe, expect, test } from "bun:test";
import { buildManifestEntry, parseGithubSource } from "./ext-install.ts";

describe("parseGithubSource", () => {
  test("parses github repo extension index source", () => {
    expect(parseGithubSource("github:owner/repo")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      dir: ".",
    });
  });

  test("parses github shorthand with explicit dir", () => {
    expect(parseGithubSource("github:owner/repo", { dir: "extensions/foo", ref: "main" })).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      dir: "extensions/foo",
      ref: "main",
    });
  });

  test("parses github shorthand with path suffix", () => {
    expect(parseGithubSource("github:owner/repo/extensions/foo")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      dir: "extensions/foo",
    });
  });

  test("parses github tree URL", () => {
    expect(parseGithubSource("https://github.com/owner/repo/tree/main/extensions/foo")).toEqual({
      type: "github",
      owner: "owner",
      repo: "repo",
      dir: "extensions/foo",
      ref: "main",
    });
  });
});

describe("buildManifestEntry", () => {
  test("uses runtime name as manifest path and normalizes contributes", () => {
    expect(
      buildManifestEntry("foo", {
        name: "upstream-foo",
        entry: "src/extension.ts",
        contributes: { internalCommands: ["foo"], hooks: ["target-start"] },
      }),
    ).toEqual({
      name: "foo",
      path: "foo",
      entry: "src/extension.ts",
      enabled: true,
      contributes: {
        internalCommands: ["foo"],
        targetTypes: [],
        hooks: ["target-start"],
        outputFormats: [],
      },
    });
  });
});
