import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function setupHistoryHome(): { home: string; manifest: string } {
  const home = mkdtempSync(join(tmpdir(), "clip-history-ext-"));
  const manifest = join(home, "extensions", "extensions.yml");
  mkdirSync(join(home, "extensions"), { recursive: true });
  writeFileSync(
    manifest,
    [
      "extensions:",
      "  - name: history",
      `    path: ${resolve("extensions/history")}`,
      "    entry: src/extension.ts",
      "    contributes:",
      "      internalCommands: [history]",
      "      targetTypes: []",
      "      hooks: [cli-end]",
      "",
    ].join("\n"),
  );
  return { home, manifest };
}

async function runClip(params: {
  home: string;
  manifest: string;
  args: string[];
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn([process.execPath, "apps/clip/src/main.ts", ...params.args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLIP_HOME: params.home,
      CLIP_EXT_MANIFEST: params.manifest,
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

describe("history extension CLI flow", () => {
  test("records a clip run through cli-end and exposes it through clip history", async () => {
    const { home, manifest } = setupHistoryHome();

    const version = await runClip({ home, manifest, args: ["--version"] });
    expect(version.exitCode).toBe(0);
    expect(version.stderr).toBe("");
    expect(version.stdout).toContain("clip ");

    const history = await runClip({ home, manifest, args: ["history", "--json"] });
    expect(history.exitCode).toBe(0);
    expect(history.stderr).toBe("");

    const parsed = JSON.parse(history.stdout) as {
      records: Array<{ id: string; command: { kind: string }; result: { exitCode: number } }>;
    };
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]?.command.kind).toBe("version");
    expect(parsed.records[0]?.result.exitCode).toBe(0);

    const table = await runClip({ home, manifest, args: ["history"] });
    expect(table.exitCode).toBe(0);
    expect(table.stdout).toContain("STATUS");
    expect(table.stdout).toContain("clip --version");

    const id = parsed.records[0]?.id.slice(0, 8) ?? "";
    const show = await runClip({ home, manifest, args: ["history", id] });
    expect(show.exitCode).toBe(0);
    expect(show.stdout).toContain(`id:      ${parsed.records[0]?.id}`);
    expect(show.stdout).toContain("command: clip --version");
  });

  test("zsh completion offers history record ids through the extension helper", async () => {
    const { home, manifest } = setupHistoryHome();

    const completion = await runClip({ home, manifest, args: ["completion", "zsh"] });
    expect(completion.exitCode).toBe(0);
    expect(completion.stderr).toBe("");
    expect(completion.stdout).toContain("_clip_ext_history()");
    expect(completion.stdout).toContain("history --format fzf --limit 100");
    expect(completion.stdout).toContain("extension_verbs");
  });
});
