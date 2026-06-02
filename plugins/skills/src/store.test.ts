import { describe, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readlink, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileStore } from "@duru/file-store";
import { createSkillsStore } from "./store.ts";

describe("createSkillsStore", () => {
  test("imports one skill from an explicit skill root without overwriting by default", async () => {
    const home = await tempDir("skills-import");
    const sourceRoot = join(home, "source");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(sourceRoot, "writer", "first");

    const imported = await store.importFromRoot(sourceRoot, { name: "writer" });

    expect(imported).toEqual({ imported: ["writer"], skipped: [] });
    await expect(store.importFromRoot(sourceRoot, { name: "writer" })).rejects.toThrow(
      "Skill already exists: writer. Use --force to replace it.",
    );
  });

  test("imports with force and exports all skills to an explicit skill root", async () => {
    const home = await tempDir("skills-export");
    const sourceRoot = join(home, "source");
    const exportRoot = join(home, "exported");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(sourceRoot, "writer", "first");
    await writeSkill(sourceRoot, "reviewer", "review");
    await store.importFromRoot(sourceRoot, { all: true });

    await writeSkill(sourceRoot, "writer", "second");
    await store.importFromRoot(sourceRoot, { name: "writer", force: true });

    const exported = await store.exportToRoot(exportRoot, { all: true });

    expect(exported).toEqual({ exported: ["reviewer", "writer"], skipped: [] });
    await expect(readFile(join(exportRoot, "duru-writer", "SKILL.md"), "utf8")).resolves.toContain("second");
    await expect(store.exportToRoot(exportRoot, { name: "writer" })).rejects.toThrow(
      "Skill already exists at destination: writer. Use --force to replace it.",
    );
  });

  test("exports skills as duru-prefixed symlinks by default", async () => {
    const home = await tempDir("skills-link-export");
    const exportRoot = join(home, "exported");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(join(home, "source"), "writer", "first");
    await store.importFromRoot(join(home, "source"), { name: "writer", mode: "copy" });

    const exported = await store.exportToRoot(exportRoot, { name: "writer" });
    const exportedPath = join(exportRoot, "duru-writer");

    expect(exported).toEqual({ exported: ["writer"], skipped: [] });
    await expect(lstat(exportedPath)).resolves.toMatchObject({ isSymbolicLink: expect.any(Function) });
    expect((await lstat(exportedPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(exportedPath)).toBe(join(home, "duru", "skills", "writer"));
  });

  test("exports copy mode with a duru marker file", async () => {
    const home = await tempDir("skills-copy-export");
    const exportRoot = join(home, "exported");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(join(home, "source"), "writer", "first");
    await store.importFromRoot(join(home, "source"), { name: "writer", mode: "copy" });

    await store.exportToRoot(exportRoot, { name: "writer", mode: "copy" });

    await expect(readFile(join(exportRoot, "duru-writer", "SKILL.md"), "utf8")).resolves.toContain("first");
    await expect(readFile(join(exportRoot, "duru-writer", ".duru-skill-link.json"), "utf8")).resolves.toContain(
      '"name":"writer"',
    );
  });

  test("imports from duru-prefixed source directories", async () => {
    const home = await tempDir("skills-prefixed-import");
    const sourceRoot = join(home, "source");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(sourceRoot, "duru-writer", "first", { metaName: "writer" });

    const imported = await store.importFromRoot(sourceRoot, { name: "writer", mode: "copy" });

    expect(imported).toEqual({ imported: ["writer"], skipped: [] });
    await expect(readFile(join(home, "duru", "skills", "writer", "SKILL.md"), "utf8")).resolves.toContain("first");
  });

  test("imports all skills from source symlinks", async () => {
    const home = await tempDir("skills-symlink-import-all");
    const sourceRoot = join(home, "source");
    const linkedRoot = join(home, "linked");
    const store = createSkillsStore(createFileStore({ root: join(home, "duru", "skills") }));

    await writeSkill(linkedRoot, "writer", "first");
    await mkdir(sourceRoot, { recursive: true });
    await symlink(join(linkedRoot, "writer"), join(sourceRoot, "duru-writer"), "dir");

    const imported = await store.importFromRoot(sourceRoot, { all: true, mode: "copy" });

    expect(imported).toEqual({ imported: ["writer"], skipped: [] });
    await expect(readFile(join(home, "duru", "skills", "writer", "SKILL.md"), "utf8")).resolves.toContain("first");
  });
});

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `duru-${label}-`));
}

async function writeSkill(
  root: string,
  name: string,
  body: string,
  options: { metaName?: string } = {},
): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    ["---", `name: ${options.metaName ?? name}`, "description: Test skill", "tags: [test]", "---", "", body, ""].join(
      "\n",
    ),
  );
}
