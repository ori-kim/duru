import { spawn } from "node:child_process";
import { join } from "node:path";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createSkillsStore } from "./store.ts";
import type { SkillsStore } from "./store.ts";
import type { SkillMeta, SkillRecord } from "./types.ts";

export { createSkillsStore };
export type { SkillMeta, SkillRecord, SkillsStore };

export function skillsPlugin(store: SkillsStore) {
  return virtualPlugin(async (cli) => {
    // duru skills → list (기본)
    cli
      .command("skills")
      .group("Skills")
      .meta({ description: "List available skills" })
      .action(async (ctx) => {
        const records = await store.list();
        const lines = records.map((r) => `${r.meta.name}  ${r.meta.description}`).join("\n");
        process.stdout.write(lines ? lines + "\n" : "(no skills installed)\n");
        return ctx.exit(0, records);
      });

    // duru skills list [--tag <tag>]
    cli
      .command("skills list")
      .group("Skills")
      .meta({ description: "List available skills" })
      .option("--tag <tag>", "Filter by tag")
      .action(async (ctx) => {
        let records = await store.list();
        const tag = (ctx.options as { tag?: string }).tag;
        if (tag) {
          records = records.filter((r) => r.meta.tags.includes(tag));
        }
        const lines = records.map((r) => `${r.meta.name}  ${r.meta.description}`).join("\n");
        process.stdout.write(lines ? lines + "\n" : "(no skills installed)\n");
        return ctx.exit(0, records);
      });

    // duru skills show <name>
    cli
      .command("skills show <name>")
      .group("Skills")
      .meta({ description: "Show SKILL.md content for a skill" })
      .action(async (ctx) => {
        const name = (ctx.params as { name: string }).name;
        const record = await store.get(name);
        if (!record) {
          process.stderr.write(`Skill not found: ${name}\n`);
          return ctx.exit(1, null);
        }
        const { readFile } = await import("node:fs/promises");
        const content = await readFile(record.skillPath, "utf8");
        process.stdout.write(content);
        return ctx.exit(0, record);
      });

    // duru skills add <path>
    cli
      .command("skills add <path>")
      .group("Skills")
      .meta({ description: "Install a skill from a local directory or SKILL.md path" })
      .action(async (ctx) => {
        const srcPath = (ctx.params as { path: string }).path;
        const record = await store.add(srcPath);
        process.stdout.write(`Installed skill: ${record.meta.name}\n`);
        return ctx.exit(0, record);
      });

    // duru skills delete <name>
    cli
      .command("skills delete <name>")
      .group("Skills")
      .meta({ description: "Remove an installed skill" })
      .action(async (ctx) => {
        const name = (ctx.params as { name: string }).name;
        await store.delete(name);
        process.stdout.write(`Deleted skill: ${name}\n`);
        return ctx.exit(0, { name });
      });

    // duru skills edit <name>
    cli
      .command("skills edit <name>")
      .group("Skills")
      .meta({ description: "Edit a skill's SKILL.md in $EDITOR" })
      .action(async (ctx) => {
        const name = (ctx.params as { name: string }).name;
        const record = await store.get(name);
        if (!record) {
          process.stderr.write(`Skill not found: ${name}\n`);
          return ctx.exit(1, null);
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
  });
}
