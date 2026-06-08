import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
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
    expect(helpText).toContain("skills status");
    expect(helpText).not.toContain("skills group status");
  });

  test("uses and clears explicit skill groups", async () => {
    const home = await tempDir("skills-cli-group-use");
    const skillsRoot = join(home, "skills");
    const targetRoot = join(home, "agent-skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill", ["subject:writing"]);
    await writeSkill(skillsRoot, "reviewer", "review skill", ["subject:writing"]);
    await writeGroups(skillsRoot, {
      writing: { description: "Writing review helpers", skills: ["writer", "reviewer"] },
    });

    const groups = await cli.run(["skills", "group", "list"], { render: false });
    expect(groups.exitCode).toBe(0);
    expect(getRenderHint(groups.result)).toBe("table");
    expect(groups.result).toMatchObject({
      rows: [{ name: "writing", description: "Writing review helpers", skills: "writer, reviewer" }],
      columns: ["name", "description", "skills"],
    });

    const used = await cli.run(["skills", "group", "use", "writing", "--to", targetRoot], { render: false });

    expect(used.exitCode).toBe(0);
    expect(used.result).toMatchObject({ group: "writing", exported: ["reviewer", "writer"], skipped: [] });
    expect((await lstat(join(targetRoot, "duru-writer"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(targetRoot, "duru-writer"))).toBe(join(skillsRoot, "writer"));

    const status = await cli.run(["skills", "status", "--to", targetRoot], { render: false });
    expect(status.exitCode).toBe(0);
    expect(getRenderHint(status.result)).toBe("table");
    expect(status.result).toMatchObject({
      searchedPaths: [targetRoot],
      text: `searched paths: ${targetRoot}`,
      rows: expect.arrayContaining([
        { name: "duru-writer", skill: "writer", safe: true, valid: true, groups: "writing" },
        { name: "duru-reviewer", skill: "reviewer", safe: true, valid: true, groups: "writing" },
      ]),
      columns: ["name", "skill", "safe", "valid", "groups"],
    });

    const legacyStatus = await cli.run(["skills", "group", "status", "--to", targetRoot], { render: false });
    expect(legacyStatus.exitCode).not.toBe(0);

    const cleared = await cli.run(["skills", "group", "clear", "writing", "--to", targetRoot], { render: false });

    expect(cleared.exitCode).toBe(0);
    expect(cleared.result).toMatchObject({ group: "writing", removed: ["reviewer", "writer"], skipped: [] });
    await expect(lstat(join(targetRoot, "duru-writer"))).rejects.toThrow();
    await expect(lstat(join(targetRoot, "duru-reviewer"))).rejects.toThrow();
  });

  test("clears all safe duru-managed entries and skips unsafe prefixed directories", async () => {
    const home = await tempDir("skills-cli-group-clear-all");
    const skillsRoot = join(home, "skills");
    const targetRoot = join(home, "agent-skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill", ["subject:writing"]);
    await writeSkill(skillsRoot, "coding", "coding skill", ["subject:coding"]);
    await mkdir(join(targetRoot, "duru-unsafe"), { recursive: true });
    await writeFile(join(targetRoot, "duru-unsafe", "SKILL.md"), "manual skill");

    await cli.run(["skills", "export", "writer", "--to", targetRoot], { render: false });
    await cli.run(["skills", "export", "coding", "--to", targetRoot], { render: false });

    const cleared = await cli.run(["skills", "group", "clear", "--all", "--to", targetRoot], { render: false });

    expect(cleared.exitCode).toBe(0);
    expect(cleared.result).toMatchObject({
      removed: ["coding", "writer"],
      skipped: [{ name: "duru-unsafe", reason: "unsafe" }],
    });
    await expect(lstat(join(targetRoot, "duru-writer"))).rejects.toThrow();
    await expect(lstat(join(targetRoot, "duru-coding"))).rejects.toThrow();
    expect((await lstat(join(targetRoot, "duru-unsafe"))).isDirectory()).toBe(true);
  });

  test("prunes exported skills from an explicit agent skill root", async () => {
    const home = await tempDir("skills-cli-prune-explicit");
    const skillsRoot = join(home, "skills");
    const targetRoot = join(home, "agent-skills");
    const outsideRoot = join(home, "outside");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill");
    await writeSkill(skillsRoot, "coding", "coding skill");
    await writeSkill(outsideRoot, "external", "external skill");
    await mkdir(join(targetRoot, "duru-manual"), { recursive: true });
    await writeFile(join(targetRoot, "duru-manual", "SKILL.md"), "manual skill");
    await mkdir(targetRoot, { recursive: true });
    await symlink(join(outsideRoot, "external"), join(targetRoot, "duru-external"), "dir");
    await cli.run(["skills", "export", "writer", "--to", targetRoot], { render: false });
    await cli.run(["skills", "export", "coding", "--to", targetRoot], { render: false });

    const pruned = await cli.run(["skills", "prune", "--to", targetRoot], { render: false });

    expect(pruned.exitCode).toBe(0);
    expect(pruned.result).toMatchObject({
      removed: ["coding", "writer"],
      skipped: [
        { name: "duru-external", reason: "unsafe" },
        { name: "duru-manual", reason: "unsafe" },
      ],
      dryRun: false,
    });
    await expect(lstat(join(targetRoot, "duru-writer"))).rejects.toThrow();
    await expect(lstat(join(targetRoot, "duru-coding"))).rejects.toThrow();
    expect((await lstat(join(targetRoot, "duru-manual"))).isDirectory()).toBe(true);
    expect((await lstat(join(targetRoot, "duru-external"))).isSymbolicLink()).toBe(true);
  });

  test("prunes default agent skill root and supports dry-run", async () => {
    const home = await tempDir("skills-cli-prune-default");
    const skillsRoot = join(home, "skills");
    const defaultRoot = join(home, ".agents", "skills");
    const cli = await createSkillsCli(home);

    await writeSkill(skillsRoot, "writer", "shared skill");

    await withFakeHome(home, async () => {
      await cli.run(["skills", "export", "writer"], { render: false });

      const dryRun = await cli.run(["skills", "prune", "--dry-run"], { render: false });

      expect(dryRun.exitCode).toBe(0);
      expect(dryRun.result).toMatchObject({ removed: ["writer"], skipped: [], dryRun: true });
      expect((await lstat(join(defaultRoot, "duru-writer"))).isSymbolicLink()).toBe(true);

      const pruned = await cli.run(["skills", "prune"], { render: false });

      expect(pruned.exitCode).toBe(0);
      expect(pruned.result).toMatchObject({ removed: ["writer"], skipped: [], dryRun: false });
      await expect(lstat(join(defaultRoot, "duru-writer"))).rejects.toThrow();
    });
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

async function withFakeHome<T>(home: string, run: () => Promise<T>): Promise<T> {
  const previousHome = process.env.HOME;
  const previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    return await run();
  } finally {
    if (previousHome === undefined) {
      process.env.HOME = undefined;
    } else {
      process.env.HOME = previousHome;
    }
    if (previousUserProfile === undefined) {
      process.env.USERPROFILE = undefined;
    } else {
      process.env.USERPROFILE = previousUserProfile;
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

type TestSkillGroup = string[] | { description?: string; skills: string[] };

async function writeGroups(root: string, groups: Record<string, TestSkillGroup>): Promise<void> {
  await mkdir(root, { recursive: true });
  const lines = Object.entries(groups).flatMap(([name, group]) => {
    if (Array.isArray(group)) return [`${name}:`, ...group.map((skill) => `  - ${skill}`)];
    return [
      `${name}:`,
      ...(group.description ? [`  description: ${group.description}`] : []),
      "  skills:",
      ...group.skills.map((skill) => `    - ${skill}`),
    ];
  });
  await writeFile(join(root, "groups.yml"), [...lines, ""].join("\n"));
}

function skillNames(value: unknown): string[] {
  const result = value as { records: Array<{ meta: { name: string } }> };
  return result.records.map((record) => record.meta.name).sort();
}
