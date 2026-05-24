import { spawn } from "node:child_process";
import { join } from "node:path";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createSkillsStore } from "./store.ts";
import type { SkillsStore } from "./store.ts";
import type { SkillMeta, SkillRecord } from "./types.ts";
import { detectAgents, importFromAgent, exportToAgent } from "./agent.ts";
import type { AgentName } from "./agent.ts";
import {
  isQmdAvailable,
  embed,
  search,
  status,
  QMD_INSTALL_MSG,
} from "./qmd.ts";

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

    // duru skills import [name] [--from claude|gemini|codex]
    cli
      .command("skills import [name]")
      .group("Skills")
      .meta({ description: "Import skills from agent skill directories into DURU_HOME" })
      .option("--from <agent>", "Source agent (claude, gemini, codex). Defaults to all detected agents.")
      .action(async (ctx) => {
        const skillName = (ctx.params as { name?: string }).name;
        const fromAgent = (ctx.options as { from?: string }).from as AgentName | undefined;

        const agents: AgentName[] = fromAgent ? [fromAgent] : await detectAgents();

        type ImportResult = { agent: AgentName; imported: string[]; skipped: string[] };
        const results: ImportResult[] = [];

        for (const agent of agents) {
          const result = await importFromAgent(agent, skillName, store);
          results.push({ agent, ...result });
          process.stdout.write(
            `[${agent}] imported ${result.imported.length}, skipped ${result.skipped.length}\n`,
          );
        }

        return ctx.exit(0, results);
      });

    // duru skills export [name] [--to claude|gemini|codex]
    cli
      .command("skills export [name]")
      .group("Skills")
      .meta({ description: "Export skills from DURU_HOME to agent skill directories" })
      .option("--to <agent>", "Target agent (claude, gemini, codex). Defaults to all detected agents.")
      .action(async (ctx) => {
        const skillName = (ctx.params as { name?: string }).name;
        const toAgent = (ctx.options as { to?: string }).to as AgentName | undefined;

        const agents: AgentName[] = toAgent ? [toAgent] : await detectAgents();

        type ExportResult = { agent: AgentName; exported: string[]; skipped: string[] };
        const results: ExportResult[] = [];

        for (const agent of agents) {
          const result = await exportToAgent(agent, skillName, store);
          results.push({ agent, ...result });
          process.stdout.write(
            `[${agent}] exported ${result.exported.length}, skipped ${result.skipped.length}\n`,
          );
        }

        return ctx.exit(0, results);
      });

    // duru skills embed
    cli
      .command("skills embed")
      .group("Skills")
      .meta({ description: "Re-index skills into qmd collection" })
      .action(async (ctx) => {
        if (!(await isQmdAvailable())) {
          return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
        }
        await embed(store.skillsDir);
        process.stdout.write("인덱싱 완료\n");
        return ctx.exit(0, { message: "인덱싱 완료" });
      });

    // duru skills search <query> [--tag <tag>]
    cli
      .command("skills search <query>")
      .group("Skills")
      .meta({ description: "Search skills using qmd semantic search" })
      .option("--tag <tag>", "Filter results by tag")
      .action(async (ctx) => {
        if (!(await isQmdAvailable())) {
          return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
        }
        const query = (ctx.params as { query: string }).query;
        const tag = (ctx.options as { tag?: string }).tag;

        let results = await search(query, { tag });

        // 태그 필터: store에서 태그 정보 가져와 클라이언트 사이드 필터링
        if (tag) {
          const taggedNames = new Set<string>();
          const records = await store.list();
          for (const record of records) {
            if (record.meta.tags.includes(tag)) {
              taggedNames.add(record.meta.name);
            }
          }
          results = results.filter((r) => taggedNames.has(r.name));
        }

        return ctx.exit(0, { results }, true);
      });

    // duru skills status
    cli
      .command("skills status")
      .group("Skills")
      .meta({ description: "Show qmd indexing status" })
      .action(async (ctx) => {
        if (!(await isQmdAvailable())) {
          return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
        }
        const raw = await status();
        process.stdout.write(raw + "\n");
        return ctx.exit(0);
      });
  });
}
