import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupExtensionHome(): { home: string; manifest: string } {
  const home = mkdtempSync(join(tmpdir(), "clip-ext-api-"));
  const extRoot = join(home, "extensions");
  const extDir = join(extRoot, "api-shape");
  const manifest = join(extRoot, "extensions.yml");
  mkdirSync(extDir, { recursive: true });
  writeFileSync(
    join(extDir, "index.ts"),
    `
export const extension = {
  name: "api-shape",
  init(api) {
    api.options.registerGlobal({ name: "trace-id", type: "value", placement: "leading" });
    api.commands.register({
      name: "echoopts",
      options: [
        { name: "check", type: "boolean" },
        { name: "version", type: "value" },
        { name: "yes", type: "boolean", aliases: ["y"] },
      ],
      async run(ctx) {
        console.log(JSON.stringify({
          args: ctx.args,
          options: ctx.options,
          globalOptions: ctx.globalOptions,
        }));
      },
    });
  },
};
`,
  );
  writeFileSync(
    manifest,
    [
      "extensions:",
      "  - name: api-shape",
      "    path: api-shape",
      "    entry: index.ts",
      "    contributes:",
      "      commands: [echoopts]",
      "      globalOptions:",
      "        - name: trace-id",
      "          type: value",
      "      hooks: []",
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

describe("extension API shape", () => {
  test("registered command options and global options are exposed to command ctx", async () => {
    const { home, manifest } = setupExtensionHome();

    const result = await runClip(
      ["--trace-id", "run-1", "echoopts", "--check", "--version", "v1.2.3", "-y", "tail"],
      home,
      manifest,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      args: string[];
      options: Record<string, unknown>;
      globalOptions: Record<string, unknown>;
    };
    expect(parsed.args).toEqual(["--check", "--version", "v1.2.3", "-y", "tail"]);
    expect(parsed.options).toEqual({ check: true, version: "v1.2.3", yes: true });
    expect(parsed.globalOptions).toEqual({ "trace-id": "run-1" });
  });
});
