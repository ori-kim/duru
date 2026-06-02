import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createRouter, withRenderHint } from "@duru/cli-kit";
import { createDuruFileHome } from "@duru/file-store";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createSkillProfileStore } from "./profiles.ts";
import type { SkillProfile, SkillProfileStatusRow } from "./profiles.ts";
import { createSkillsStore } from "./store.ts";
import type { SkillsStore } from "./store.ts";
import type { SkillMeta, SkillRecord } from "./types.ts";

export { createSkillsStore };
export type { SkillMeta, SkillRecord, SkillsStore };

export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const store = createSkillsStore(home.scope("skills"));
  const profileStore = createSkillProfileStore(home.resolve("skill-profiles"), store);

  const skills = createRouter();
  const tags = createRouter();
  const profiles = createRouter();

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
    .option("--copy", "Copy directories instead of creating symlinks")
    .action(async (ctx) => {
      const skillName = (ctx.params as { name?: string }).name;
      const opts = ctx.options as { from?: string; all?: boolean; force?: boolean; copy?: boolean };
      if (!opts.from) return ctx.exit(2, { error: { message: "--from <path> is required" } });
      const result = await store.importFromRoot(resolve(opts.from), {
        name: skillName,
        all: opts.all === true,
        force: opts.force === true,
        mode: opts.copy === true ? "copy" : "link",
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
    .option("--copy", "Copy directories instead of creating symlinks")
    .action(async (ctx) => {
      const skillName = (ctx.params as { name?: string }).name;
      const opts = ctx.options as { to?: string; all?: boolean; force?: boolean; copy?: boolean };
      const result = await store.exportToRoot(resolveSkillRoot(opts.to), {
        name: skillName,
        all: opts.all === true,
        force: opts.force === true,
        mode: opts.copy === true ? "copy" : "link",
      });
      return ctx.exit(
        0,
        withRenderHint(
          { ...result, text: `Exported ${result.exported.length}, skipped ${result.skipped.length}` },
          "text",
        ),
      );
    });

  profiles
    .command("list")
    .group("Skills")
    .meta({ description: "List skill profiles" })
    .action(async (ctx) => {
      const records = await profileStore.list();
      return ctx.exit(0, skillProfileListResult(records));
    });

  profiles
    .command("show <name>")
    .group("Skills")
    .meta({ description: "Show a skill profile" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const profile = await profileStore.get(name);
      if (!profile) return ctx.exit(1, errorResult(`Profile not found: ${name}`));
      return ctx.exit(0, withRenderHint({ text: renderProfile(profile), profile }, "text"));
    });

  profiles
    .command("use <name>")
    .group("Skills")
    .meta({ description: "Expose every skill in a profile to an agent skill root" })
    .option("--to <path>", "Destination skill root path")
    .option("--force", "Replace existing destination skills")
    .option("--copy", "Copy directories instead of creating symlinks")
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const opts = ctx.options as { to?: string; force?: boolean; copy?: boolean };
      const result = await profileStore.use(name, resolveSkillRoot(opts.to), {
        force: opts.force === true,
        mode: opts.copy === true ? "copy" : "link",
      });
      return ctx.exit(0, withRenderHint({ ...result, text: `Activated profile: ${result.profile}` }, "text"));
    });

  profiles
    .command("clear [name]")
    .group("Skills")
    .meta({ description: "Remove duru-managed profile skills from an agent skill root" })
    .option("--to <path>", "Destination skill root path")
    .option("--all", "Clear every safe duru-managed skill entry")
    .action(async (ctx) => {
      const name = (ctx.params as { name?: string }).name;
      const opts = ctx.options as { to?: string; all?: boolean };
      const result = await profileStore.clear(resolveSkillRoot(opts.to), { name, all: opts.all === true });
      return ctx.exit(0, withRenderHint({ ...result, text: `Removed ${result.removed.length} skills` }, "text"));
    });

  profiles
    .command("status")
    .group("Skills")
    .meta({ description: "Show duru-managed skills in an agent skill root" })
    .option("--to <path>", "Destination skill root path")
    .action(async (ctx) => {
      const opts = ctx.options as { to?: string };
      const rows = await profileStore.status(resolveSkillRoot(opts.to));
      return ctx.exit(0, skillProfileStatusResult(rows));
    });

  skills.subCommand("profile", profiles as never);
  cli.subCommand("skills", skills as never);
});

type SkillListRow = {
  name: string;
  tags: string;
  description: string;
};

function skillListResult(records: SkillRecord[]): {
  records: SkillRecord[];
  items: string[];
  rows: SkillListRow[];
  columns: string[];
} {
  return withRenderHint(
    {
      records,
      items: records.map((r) => `${r.meta.name}  ${r.meta.description ?? ""}`),
      rows: records.map((record) => ({
        name: record.meta.name,
        tags: record.meta.tags.join(", "),
        description: truncate(record.meta.description ?? "", 96),
      })),
      columns: ["name", "tags", "description"],
    },
    "table",
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
  rows: SkillTagRow[];
  columns: string[];
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
      rows: tags.map(skillTagRow),
      columns: ["facet", "value", "count", "tag"],
    },
    "table",
  );
}

type SkillTagRow = {
  facet: string;
  value: string;
  count: number;
  tag: string;
};

function skillTagRow(tag: SkillTagCount): SkillTagRow {
  const colonIndex = tag.tag.indexOf(":");
  return {
    facet: colonIndex === -1 ? "legacy" : tag.tag.slice(0, colonIndex),
    value: colonIndex === -1 ? tag.tag : tag.tag.slice(colonIndex + 1),
    count: tag.count,
    tag: tag.tag,
  };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
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

function resolveSkillRoot(path?: string): string {
  if (!path) return join(homedir(), ".agents", "skills");
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return resolve(path);
}

type SkillProfileRow = {
  name: string;
  skills: string;
};

function skillProfileListResult(profiles: SkillProfile[]): {
  profiles: SkillProfile[];
  rows: SkillProfileRow[];
  columns: string[];
} {
  return withRenderHint(
    {
      profiles,
      rows: profiles.map((profile) => ({ name: profile.name, skills: profile.skills.join(", ") })),
      columns: ["name", "skills"],
    },
    "table",
  );
}

function skillProfileStatusResult(rows: SkillProfileStatusRow[]): {
  rows: SkillProfileStatusRow[];
  columns: string[];
} {
  return withRenderHint({ rows, columns: ["name", "skill", "safe", "valid", "profiles"] }, "table");
}

function renderProfile(profile: SkillProfile): string {
  return [`name: ${profile.name}`, "skills:", ...profile.skills.map((skill) => `  - ${skill}`)].join("\n");
}

function errorResult(message: string): { message: string; exitCode: number } {
  return withRenderHint({ message, exitCode: 1 }, "error");
}
