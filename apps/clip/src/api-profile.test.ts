import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function setupApiProfileHome(): string {
  const home = mkdtempSync(join(tmpdir(), "clip-api-profile-"));
  const targetDir = join(home, "target", "api", "catservice");
  mkdirSync(targetDir, { recursive: true });

  writeFileSync(
    join(targetDir, "config.yml"),
    [
      "baseUrl: https://catservice.example.com",
      "auth: false",
      "profiles:",
      "  dev:",
      "    headers:",
      "      X-Custom-Header: custom-profile",
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(targetDir, "spec.json"),
    JSON.stringify(
      {
        openapi: "3.0.3",
        paths: {
          "/v1/cats": {
            get: {
              operationId: "list-cats",
              summary: "List cats",
              parameters: [
                {
                  name: "X-Custom-Header",
                  in: "header",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: { "200": { description: "OK" } },
            },
          },
        },
      },
      null,
      2,
    ),
  );

  return home;
}

async function runClip(home: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "apps/clip/src/main.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLIP_HOME: home,
      CLIP_NO_EXTENSIONS: "1",
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

  return { exitCode, stdout, stderr };
}

describe("API target profile CLI flow", () => {
  test("one-shot profile dry-run uses the base target spec cache and injected headers", async () => {
    const home = setupApiProfileHome();
    const result = await runClip(home, ["catservice@dev", "list-cats", "--dry-run"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("curl -X GET 'https://catservice.example.com/v1/cats'");
    expect(result.stdout).toContain("-H 'X-Custom-Header: custom-profile'");
  });

  test("one-shot profile help marks profile headers as injected", async () => {
    const home = setupApiProfileHome();
    const result = await runClip(home, ["catservice@dev", "list-cats", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const headerLine = result.stdout.split("\n").find((line) => line.includes("--X-Custom-Header"));
    expect(headerLine).toContain("[injected]");
    expect(headerLine).not.toContain("(required)");
  });
});
