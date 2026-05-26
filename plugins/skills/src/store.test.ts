import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    await expect(readFile(join(exportRoot, "writer", "SKILL.md"), "utf8")).resolves.toContain("second");
    await expect(store.exportToRoot(exportRoot, { name: "writer" })).rejects.toThrow(
      "Skill already exists at destination: writer. Use --force to replace it.",
    );
  });
});

async function tempDir(label: string): Promise<string> {
  return mkdtemp(join(tmpdir(), `duru-${label}-`));
}

async function writeSkill(root: string, name: string, body: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "SKILL.md"),
    ["---", `name: ${name}`, "description: Test skill", "tags: [test]", "---", "", body, ""].join("\n"),
  );
}
