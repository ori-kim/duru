import { describe, expect, test } from "bun:test";
import { ClipError } from "@clip/core";
import {
  type UpdateDeps,
  assetNameFor,
  compareVersions,
  parseUpdateArgs,
  runUpdate,
  selfUpdatePath,
} from "./update.ts";

function release(tag: string) {
  return {
    tag_name: tag,
    assets: [
      { name: "clip-darwin-arm64", browser_download_url: "https://api.example.com/clip-darwin-arm64" },
      { name: "clip-darwin-arm64.sha256", browser_download_url: "https://api.example.com/clip-darwin-arm64.sha256" },
    ],
  };
}

function depsFor(body = release("v999.0.0")): { deps: UpdateDeps; out: string[]; urls: string[] } {
  const out: string[] = [];
  const urls: string[] = [];
  return {
    out,
    urls,
    deps: {
      fetch: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify(body), { status: 200 });
      },
      execPath: "/tmp/clip",
      platform: "darwin",
      arch: "arm64",
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: () => {} },
      confirm: async () => true,
      runQuiet: () => {},
    },
  };
}

describe("clip update", () => {
  test("parses flags", () => {
    expect(parseUpdateArgs(["--check"])).toMatchObject({ check: true });
    expect(parseUpdateArgs(["--version", "0.1.2", "--yes", "--dry-run", "--force"])).toEqual({
      check: false,
      dryRun: true,
      force: true,
      yes: true,
      tag: "v0.1.2",
    });
  });

  test("compares HeadVer-style dotted versions", () => {
    expect(compareVersions("v0.2619.128", "v0.2619.127")).toBe(1);
    expect(compareVersions("v0.2619.127", "v0.2619.127")).toBe(0);
    expect(compareVersions("v0.2619.1", "v0.2619.127")).toBe(-1);
  });

  test("selects platform release asset", () => {
    expect(assetNameFor("darwin", "arm64")).toBe("clip-darwin-arm64");
    expect(assetNameFor("darwin", "x64")).toBe("clip-darwin-x64");
    expect(() => assetNameFor("linux", "arm64")).toThrow(ClipError);
  });

  test("rejects source or package-manager invocations for replacement", () => {
    expect(() => selfUpdatePath("/usr/local/bin/bun")).toThrow("requires a compiled clip binary");
    expect(() => selfUpdatePath("/usr/local/bin/not-clip")).toThrow("Refusing to replace non-clip executable");
    expect(selfUpdatePath("/Users/example/.local/bin/clip")).toBe("/Users/example/.local/bin/clip");
  });

  test("--check only reads release metadata", async () => {
    const { deps, out, urls } = depsFor(release("v999.0.0"));

    await runUpdate(["--check"], deps);

    expect(urls).toEqual(["https://api.github.com/repos/ori-kim/cli-proxy/releases/latest"]);
    expect(out.join("")).toContain("current: v");
    expect(out.join("")).toContain("latest:  v999.0.0");
  });

  test("--dry-run prints planned replacement without downloading assets", async () => {
    const { deps, out, urls } = depsFor(release("v999.0.0"));

    await runUpdate(["--dry-run", "--yes"], deps);

    expect(urls).toEqual(["https://api.github.com/repos/ori-kim/cli-proxy/releases/latest"]);
    expect(out.join("")).toContain("action:  replace local clip binary");
    expect(out.join("")).toContain("asset:   clip-darwin-arm64");
  });
});
