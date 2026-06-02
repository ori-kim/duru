import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createCli, getRenderHint, help } from "@duru/cli-kit";
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
    expect((await lstat(join(exportRoot, "duru-writer"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(exportRoot, "duru-writer"))).toBe(join(home, "skills", "writer"));
    await expect(readFile(join(exportRoot, "duru-writer", "SKILL.md"), "utf8")).resolves.toContain("shared skill");
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

  test("returns table-shaped rows for skill and tag lists", async () => {
    const home = await tempDir("skills-cli-table");
    const skillsRoot = join(home, "skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill", ["scope:agent", "subject:writing"]);

    const list = await cli.run(["skills", "list"], { render: false });
    const tags = await cli.run(["skills", "tag", "list"], { render: false });

    expect(getRenderHint(list.result)).toBe("table");
    expect(list.result).toMatchObject({
      rows: [
        {
          name: "writer",
          tags: "scope:agent, subject:writing",
          description: "Test skill",
        },
      ],
      columns: ["name", "tags", "description"],
    });
    expect(getRenderHint(tags.result)).toBe("table");
    expect(tags.result).toMatchObject({
      rows: expect.arrayContaining([
        { facet: "scope", value: "agent", count: 1, tag: "scope:agent" },
        { facet: "subject", value: "writing", count: 1, tag: "subject:writing" },
      ]),
      columns: ["facet", "value", "count", "tag"],
    });
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

  test("uses and clears explicit skill profiles", async () => {
    const home = await tempDir("skills-cli-profile-use");
    const skillsRoot = join(home, "skills");
    const profileRoot = join(home, "skill-profiles");
    const targetRoot = join(home, "agent-skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill", ["subject:writing"]);
    await writeSkill(skillsRoot, "reviewer", "review skill", ["subject:writing"]);
    await writeProfile(profileRoot, "writing", ["writer", "reviewer"]);

    const used = await cli.run(["skills", "profile", "use", "writing", "--to", targetRoot], { render: false });

    expect(used.exitCode).toBe(0);
    expect(used.result).toMatchObject({ profile: "writing", exported: ["reviewer", "writer"], skipped: [] });
    expect((await lstat(join(targetRoot, "duru-writer"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(targetRoot, "duru-writer"))).toBe(join(skillsRoot, "writer"));

    const status = await cli.run(["skills", "profile", "status", "--to", targetRoot], { render: false });
    expect(status.exitCode).toBe(0);
    expect(status.result).toMatchObject({
      rows: expect.arrayContaining([
        { name: "duru-writer", skill: "writer", safe: true, valid: true, profiles: "writing" },
        { name: "duru-reviewer", skill: "reviewer", safe: true, valid: true, profiles: "writing" },
      ]),
    });

    const cleared = await cli.run(["skills", "profile", "clear", "writing", "--to", targetRoot], { render: false });

    expect(cleared.exitCode).toBe(0);
    expect(cleared.result).toMatchObject({ profile: "writing", removed: ["reviewer", "writer"], skipped: [] });
    await expect(lstat(join(targetRoot, "duru-writer"))).rejects.toThrow();
    await expect(lstat(join(targetRoot, "duru-reviewer"))).rejects.toThrow();
  });

  test("clears all safe duru-managed entries and skips unsafe prefixed directories", async () => {
    const home = await tempDir("skills-cli-profile-clear-all");
    const skillsRoot = join(home, "skills");
    const targetRoot = join(home, "agent-skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill", ["subject:writing"]);
    await writeSkill(skillsRoot, "coding", "coding skill", ["subject:coding"]);
    await mkdir(join(targetRoot, "duru-unsafe"), { recursive: true });
    await writeFile(join(targetRoot, "duru-unsafe", "SKILL.md"), "manual skill");

    await cli.run(["skills", "export", "writer", "--to", targetRoot], { render: false });
    await cli.run(["skills", "export", "coding", "--to", targetRoot], { render: false });

    const cleared = await cli.run(["skills", "profile", "clear", "--all", "--to", targetRoot], { render: false });

    expect(cleared.exitCode).toBe(0);
    expect(cleared.result).toMatchObject({
      removed: ["coding", "writer"],
      skipped: [{ name: "duru-unsafe", reason: "unsafe" }],
    });
    await expect(lstat(join(targetRoot, "duru-writer"))).rejects.toThrow();
    await expect(lstat(join(targetRoot, "duru-coding"))).rejects.toThrow();
    expect((await lstat(join(targetRoot, "duru-unsafe"))).isDirectory()).toBe(true);
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

async function writeProfile(root: string, name: string, skills: string[]): Promise<void> {
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, `${name}.yml`),
    [`name: ${name}`, "skills:", ...skills.map((skill) => `  - ${skill}`), ""].join("\n"),
  );
}

function skillNames(value: unknown): string[] {
  const result = value as { records: Array<{ meta: { name: string } }> };
  return result.records.map((record) => record.meta.name).sort();
}
