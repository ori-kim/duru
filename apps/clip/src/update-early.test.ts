import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupBrokenExtension(): { home: string; manifest: string } {
  const home = mkdtempSync(join(tmpdir(), "clip-update-early-"));
  const extRoot = join(home, "extensions");
  const extDir = join(extRoot, "broken");
  const manifest = join(extRoot, "extensions.yml");
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, "index.ts"),
    `
export const extension = {
  name: "broken",
  init(api) {
    api.registerHook("beforeExecute", () => {});
  },
};
`,
  );
  writeFileSync(
    manifest,
    [
      "extensions:",
      "  - name: broken",
      "    path: broken",
      "    entry: index.ts",
      "    contributes:",
      "      commands: []",
      "      targetTypes: []",
      "      hooks: [command-start]",
      "",
    ].join("\n"),
  );
  return { home, manifest };
}

async function runClip(args: string[], home: string, manifest: string) {
  const proc = Bun.spawn([process.execPath, "apps/clip/src/main.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLIP_HOME: home,
      CLIP_EXT_MANIFEST: manifest,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("early built-in commands", () => {
  test("clip update --help runs before user extensions are loaded", async () => {
    const { home, manifest } = setupBrokenExtension();

    const result = await runClip(["update", "--help"], home, manifest);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("clip update");
  });
});
