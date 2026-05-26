import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { createRouter, withRenderHint } from "@duru/cli-kit";
import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createSkillsStore } from "./store.ts";
import type { SkillsStore } from "./store.ts";
import type { SkillMeta, SkillRecord } from "./types.ts";

export { createSkillsStore };
export type { SkillMeta, SkillRecord, SkillsStore };

export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const store = createSkillsStore(home.scope("skills"));

  const skills = createRouter();
  const tags = createRouter();

  skills
    .command()
    .group("Skills")
    .meta({ description: "List available skills" })
    .action(async (ctx) => {
      const records = await store.list();
      return ctx.exit(0, skillListResult(records));
    });

  skills
    .command("list")
    .group("Skills")
    .meta({ description: "List available skills" })
    .option("--tag <tag>", "Filter by tag")
    .action(async (ctx) => {
      let records = await store.list();
      const tags = optionValues((ctx.options as { tag?: unknown }).tag);
      if (tags.length > 0) records = records.filter((r) => tags.every((tag) => r.meta.tags.includes(tag)));
      return ctx.exit(0, skillListResult(records));
    });

  tags
    .command("list")
    .group("Skills")
    .meta({ description: "List skill tags with counts" })
    .action(async (ctx) => {
      const records = await store.list();
      return ctx.exit(0, skillTagListResult(records));
    });

  skills.subCommand("tag", tags as never);

  skills
    .command("show <name>")
    .group("Skills")
    .meta({ description: "Show SKILL.md content for a skill" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const record = await store.get(name);
      if (!record) {
        return ctx.exit(1, errorResult(`Skill not found: ${name}`));
      }
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(record.skillPath, "utf8");
      return ctx.exit(0, withRenderHint({ text: content, record }, "text"));
    });

  skills
    .command("add <path>")
    .group("Skills")
    .meta({ description: "Install a skill from a local directory or SKILL.md path" })
    .action(async (ctx) => {
      const srcPath = (ctx.params as { path: string }).path;
      const record = await store.add(srcPath);
      return ctx.exit(0, withRenderHint({ text: `Installed skill: ${record.meta.name}`, record }, "text"));
    });

  skills
    .command("delete <name>")
    .group("Skills")
    .meta({ description: "Remove an installed skill" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      await store.delete(name);
      return ctx.exit(0, withRenderHint({ text: `Deleted skill: ${name}`, name }, "text"));
    });

  skills
    .command("edit <name>")
    .group("Skills")
    .meta({ description: "Edit a skill's SKILL.md in $EDITOR" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const record = await store.get(name);
      if (!record) {
        return ctx.exit(1, errorResult(`Skill not found: ${name}`));
      }
      const editor = process.env.EDITOR ?? "vi";
      await new Promise<void>((resolve, reject) => {
        const child = spawn(editor, [record.skillPath], { stdio: "inherit" });
        child.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Editor exited with code ${code}`));
        });
        child.on("error", reject);
      });
      return ctx.exit(0, record);
    });

  skills
    .command("import [name]")
    .group("Skills")
    .meta({ description: "Import skills from an explicit skill root into DURU_HOME" })
    .option("--from <path>", "Source skill root path")
    .option("--all", "Import every skill from the source root")
    .option("--force", "Replace existing skills")
    .action(async (ctx) => {
      const skillName = (ctx.params as { name?: string }).name;
      const opts = ctx.options as { from?: string; all?: boolean; force?: boolean };
      if (!opts.from) return ctx.exit(2, { error: { message: "--from <path> is required" } });
      const result = await store.importFromRoot(resolve(opts.from), {
        name: skillName,
        all: opts.all === true,
        force: opts.force === true,
      });
      return ctx.exit(
        0,
        withRenderHint(
          { ...result, text: `Imported ${result.imported.length}, skipped ${result.skipped.length}` },
          "text",
        ),
      );
    });

  skills
    .command("export [name]")
    .group("Skills")
    .meta({ description: "Export skills from DURU_HOME to an explicit skill root" })
    .option("--to <path>", "Destination skill root path")
    .option("--all", "Export every installed skill")
    .option("--force", "Replace existing destination skills")
    .action(async (ctx) => {
      const skillName = (ctx.params as { name?: string }).name;
      const opts = ctx.options as { to?: string; all?: boolean; force?: boolean };
      if (!opts.to) return ctx.exit(2, { error: { message: "--to <path> is required" } });
      const result = await store.exportToRoot(resolve(opts.to), {
        name: skillName,
        all: opts.all === true,
        force: opts.force === true,
      });
      return ctx.exit(
        0,
        withRenderHint(
          { ...result, text: `Exported ${result.exported.length}, skipped ${result.skipped.length}` },
          "text",
        ),
      );
    });

  cli.subCommand("skills", skills as never);
});

function skillListResult(records: SkillRecord[]): { records: SkillRecord[]; items: string[] } {
  return withRenderHint(
    {
      records,
      items: records.map((r) => `${r.meta.name}  ${r.meta.description ?? ""}`),
    },
    "list",
  );
}

type SkillTagCount = {
  tag: string;
  count: number;
};

type SkillTagFacet = {
  key: string;
  values: Array<SkillTagCount & { value: string }>;
};

function skillTagListResult(records: SkillRecord[]): {
  tags: SkillTagCount[];
  facets: SkillTagFacet[];
  items: string[];
} {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of new Set(record.meta.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  const tags = [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
  const facetMap = new Map<string, Array<SkillTagCount & { value: string }>>();
  for (const tag of tags) {
    const colonIndex = tag.tag.indexOf(":");
    const key = colonIndex === -1 ? "legacy" : tag.tag.slice(0, colonIndex);
    const value = colonIndex === -1 ? tag.tag : tag.tag.slice(colonIndex + 1);
    const values = facetMap.get(key) ?? [];
    values.push({ ...tag, value });
    facetMap.set(key, values);
  }
  const facets = [...facetMap.entries()]
    .map(([key, values]) => ({ key, values: values.sort((a, b) => a.value.localeCompare(b.value)) }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return withRenderHint(
    {
      tags,
      facets,
      items: tags.map((tag) => `${tag.tag}  ${tag.count}`),
    },
    "list",
  );
}

function optionValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitOptionValue);
  if (typeof value === "string") return splitOptionValue(value);
  return [];
}

function splitOptionValue(value: unknown): string[] {
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorResult(message: string): { message: string; exitCode: number } {
  return withRenderHint({ message, exitCode: 1 }, "error");
}
