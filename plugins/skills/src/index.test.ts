import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createCli, help } from "@duru/cli-kit";
import skillsPlugin from "./index.ts";

describe("skills plugin", () => {
  test("imports and exports skills through explicit root paths", async () => {
    const home = await tempDir("skills-cli");
    const sourceRoot = join(home, "source");
    const exportRoot = join(home, "exported");
    const sourceArg = relative(process.cwd(), sourceRoot);
    const exportArg = relative(process.cwd(), exportRoot);

    await writeSkill(sourceRoot, "writer", "shared skill");
    const cli = await createSkillsCli(home);

    const imported = await cli.run(["skills", "import", "writer", "--from", sourceArg], { render: false });
    const exported = await cli.run(["skills", "export", "writer", "--to", exportArg], { render: false });

    expect(imported.exitCode).toBe(0);
    expect(imported.result).toMatchObject({ imported: ["writer"], skipped: [] });
    expect(exported.exitCode).toBe(0);
    expect(exported.result).toMatchObject({ exported: ["writer"], skipped: [] });
    await expect(readFile(join(exportRoot, "writer", "SKILL.md"), "utf8")).resolves.toContain("shared skill");
  });

  test("returns command output through results instead of writing directly to stdout", async () => {
    const home = await tempDir("skills-cli-renderer");
    const sourceRoot = join(home, "source");

    await writeSkill(sourceRoot, "writer", "shared skill");
    const cli = await createSkillsCli(home);

    const writes = await captureProcessWrites(async () => {
      await cli.run(["skills", "import", "writer", "--from", sourceRoot], { render: false });
      await cli.run(["skills"], { render: false });
      await cli.run(["skills", "show", "writer"], { render: false });
    });

    expect(writes).toEqual({ stdout: "", stderr: "" });
  });

  test("lists tags and filters skills by one or more tags", async () => {
    const home = await tempDir("skills-cli-tags");
    const skillsRoot = join(home, "skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "kotlin", "kotlin skill", [
      "scope:project",
      "subject:karavan",
      "subject:kotlin",
      "intent:apply-guidelines",
    ]);
    await writeSkill(skillsRoot, "graphite", "graphite skill", [
      "scope:project",
      "subject:karavan",
      "intent:stack-branch",
    ]);
    await writeSkill(skillsRoot, "typescript", "typescript skill", ["scope:project", "subject:typescript"]);

    const tags = await cli.run(["skills", "tag", "list"], { render: false });
    const karavan = await cli.run(["skills", "list", "--tag", "subject:karavan"], { render: false });
    const karavanStack = await cli.run(["skills", "list", "--tag", "subject:karavan", "--tag", "intent:stack-branch"], {
      render: false,
    });
    const karavanStackCsv = await cli.run(["skills", "list", "--tag", "subject:karavan,intent:stack-branch"], {
      render: false,
    });

    expect(tags.exitCode).toBe(0);
    expect(tags.result).toMatchObject({
      tags: expect.arrayContaining([
        { tag: "scope:project", count: 3 },
        { tag: "subject:karavan", count: 2 },
        { tag: "intent:stack-branch", count: 1 },
      ]),
      facets: expect.arrayContaining([
        {
          key: "subject",
          values: expect.arrayContaining([
            { value: "karavan", tag: "subject:karavan", count: 2 },
            { value: "kotlin", tag: "subject:kotlin", count: 1 },
          ]),
        },
      ]),
    });
    expect(skillNames(karavan.result)).toEqual(["graphite", "kotlin"]);
    expect(skillNames(karavanStack.result)).toEqual(["graphite"]);
    expect(skillNames(karavanStackCsv.result)).toEqual(["graphite"]);
  });

  test("requires --all when import or export omits a skill name", async () => {
    const home = await tempDir("skills-cli-all");
    const sourceRoot = join(home, "source");
    const cli = await createSkillsCli(home);

    const imported = await cli.run(["skills", "import", "--from", sourceRoot], { render: false });
    const exported = await cli.run(["skills", "export", "--to", join(home, "exported")], { render: false });

    expect(imported.exitCode).toBe(1);
    expect(imported.result).toEqual({ error: { message: "Pass a skill name or --all." } });
    expect(exported.exitCode).toBe(1);
    expect(exported.result).toEqual({ error: { message: "Pass a skill name or --all." } });
  });

  test("removes qmd-specific commands from skills help", async () => {
    const home = await tempDir("skills-cli-help");
    const cli = await createSkillsCli(home);

    const help = await cli.run(["skills", "--help"], { render: false });
    const helpText = JSON.stringify(help.result);

    expect(help.exitCode).toBe(0);
    expect(helpText).not.toContain("skills search");
    expect(helpText).not.toContain("skills embed");
    expect(helpText).not.toContain("skills status");
  });
});

async function createSkillsCli(home: string): Promise<ReturnType<typeof createCli>> {
  const previousHome = process.env.DURU_HOME;
  process.env.DURU_HOME = home;
  try {
    const cli = createCli({ name: "duru" }).use(help());
    cli.catch((ctx) =>
      ctx.exit(1, { error: { message: ctx.error instanceof Error ? ctx.error.message : String(ctx.error) } }),
    );
    await skillsPlugin.install(cli);
    return cli;
  } finally {
    if (previousHome === undefined) {
      process.env.DURU_HOME = undefined;
    } else {
      process.env.DURU_HOME = previousHome;
    }
  }
}

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `duru-${label}-`));
}

async function captureProcessWrites(run: () => Promise<void>): Promise<{ stdout: string; stderr: string }> {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";

  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    await run();
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }

  return { stdout, stderr };
}

async function writeSkill(root: string, name: string, body: string, tags = ["test"]): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: Test skill", `tags: [${tags.join(", ")}]`, "---", "", body, ""].join("\n"),
  );
}

function skillNames(value: unknown): string[] {
  const result = value as { records: Array<{ meta: { name: string } }> };
  return result.records.map((record) => record.meta.name).sort();
}
