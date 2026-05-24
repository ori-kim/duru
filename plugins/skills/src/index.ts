import { spawn } from "node:child_process";
import { createDuruFileHome } from "@duru/file-store";
import { createRouter } from "@duru/cli-kit";
import { virtualPlugin } from "@duru/virtual-plugins";
import { createSkillsStore } from "./store.ts";
import type { SkillsStore } from "./store.ts";
import type { SkillMeta, SkillRecord } from "./types.ts";
import { detectAgents, importFromAgent, exportToAgent } from "./agent.ts";
import type { AgentName } from "./agent.ts";
import { COLLECTION, QMD_INSTALL_MSG, createQmdClient } from "./qmd.ts";
import type { QmdClient } from "./qmd.ts";

export { createSkillsStore, createQmdClient };
export type { SkillMeta, SkillRecord, SkillsStore, QmdClient };

async function tryEmbed(qmd: QmdClient, store: SkillsStore): Promise<void> {
  try {
    if (!(await qmd.isAvailable())) return;
    await qmd.ensureCollection(COLLECTION, store.skillsDir);
    await qmd.embed(COLLECTION);
  } catch {}
}

export default virtualPlugin(async (cli) => {
  const home = createDuruFileHome({ env: process.env });
  const store = createSkillsStore(home.scope("skills"));
  const qmd = createQmdClient(home.resolve("skills/.data"));

  const skills = createRouter();

  skills.command().group("Skills").meta({ description: "List available skills" }).action(async (ctx) => {
    const records = await store.list();
    const lines = records.map((r) => `${r.meta.name}  ${r.meta.description}`).join("\n");
    process.stdout.write(lines ? lines + "\n" : "(no skills installed)\n");
    return ctx.exit(0, records);
  });

  skills.command("list").group("Skills").meta({ description: "List available skills" })
    .option("--tag <tag>", "Filter by tag")
    .action(async (ctx) => {
      let records = await store.list();
      const tag = (ctx.options as { tag?: string }).tag;
      if (tag) records = records.filter((r) => r.meta.tags.includes(tag));
      const lines = records.map((r) => `${r.meta.name}  ${r.meta.description}`).join("\n");
      process.stdout.write(lines ? lines + "\n" : "(no skills installed)\n");
      return ctx.exit(0, records);
    });

  skills.command("show <name>").group("Skills").meta({ description: "Show SKILL.md content for a skill" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const record = await store.get(name);
      if (!record) { process.stderr.write(`Skill not found: ${name}\n`); return ctx.exit(1, null); }
      const { readFile } = await import("node:fs/promises");
      const content = await readFile(record.skillPath, "utf8");
      process.stdout.write(content);
      return ctx.exit(0, record);
    });

  skills.command("add <path>").group("Skills").meta({ description: "Install a skill from a local directory or SKILL.md path" })
    .action(async (ctx) => {
      const srcPath = (ctx.params as { path: string }).path;
      const record = await store.add(srcPath);
      process.stdout.write(`Installed skill: ${record.meta.name}\n`);
      await tryEmbed(qmd, store);
      return ctx.exit(0, record);
    });

  skills.command("delete <name>").group("Skills").meta({ description: "Remove an installed skill" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      await store.delete(name);
      process.stdout.write(`Deleted skill: ${name}\n`);
      await tryEmbed(qmd, store);
      return ctx.exit(0, { name });
    });

  skills.command("edit <name>").group("Skills").meta({ description: "Edit a skill's SKILL.md in $EDITOR" })
    .action(async (ctx) => {
      const name = (ctx.params as { name: string }).name;
      const record = await store.get(name);
      if (!record) { process.stderr.write(`Skill not found: ${name}\n`); return ctx.exit(1, null); }
      const editor = process.env.EDITOR ?? "vi";
      await new Promise<void>((resolve, reject) => {
        const child = spawn(editor, [record.skillPath], { stdio: "inherit" });
        child.on("close", (code) => { if (code === 0) resolve(); else reject(new Error(`Editor exited with code ${code}`)); });
        child.on("error", reject);
      });
      await tryEmbed(qmd, store);
      return ctx.exit(0, record);
    });

  skills.command("import [name]").group("Skills").meta({ description: "Import skills from agent skill directories into DURU_HOME" })
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
        process.stdout.write(`[${agent}] imported ${result.imported.length}, skipped ${result.skipped.length}\n`);
      }
      await tryEmbed(qmd, store);
      return ctx.exit(0, results);
    });

  skills.command("export [name]").group("Skills").meta({ description: "Export skills from DURU_HOME to agent skill directories" })
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
        process.stdout.write(`[${agent}] exported ${result.exported.length}, skipped ${result.skipped.length}\n`);
      }
      return ctx.exit(0, results);
    });

  skills.command("embed").group("Skills").meta({ description: "Re-index skills into qmd collection" })
    .action(async (ctx) => {
      if (!(await qmd.isAvailable())) return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
      await qmd.ensureCollection(COLLECTION, store.skillsDir);
      await qmd.embed(COLLECTION);
      process.stdout.write("인덱싱 완료\n");
      return ctx.exit(0, { message: "인덱싱 완료" });
    });

  skills.command("search <query>").group("Skills").meta({ description: "Search skills using qmd (lex/vec/query)" })
    .option("--tag <tag>", "Filter results by tag")
    .option("--mode <mode>", "Search mode: lex (BM25), vec (vector), query (hybrid+LLM). Default: query")
    .action(async (ctx) => {
      if (!(await qmd.isAvailable())) return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
      const queryStr = (ctx.params as { query: string }).query;
      const tag = (ctx.options as { tag?: string; mode?: string }).tag;
      const mode = (ctx.options as { mode?: string }).mode ?? "query";
      let results;
      if (mode === "lex") { results = await qmd.lex(queryStr, COLLECTION); }
      else if (mode === "vec") { results = await qmd.vsearch(queryStr, COLLECTION); }
      else { results = await qmd.query(queryStr, COLLECTION); }
      if (tag) {
        const taggedNames = new Set((await store.list()).filter((r) => r.meta.tags.includes(tag)).map((r) => r.meta.name));
        results = results.filter((r) => taggedNames.has(r.name));
      }
      return ctx.exit(0, { results }, true);
    });

  skills.command("status").group("Skills").meta({ description: "Show qmd indexing status" })
    .action(async (ctx) => {
      if (!(await qmd.isAvailable())) return ctx.exit(1, { error: { message: QMD_INSTALL_MSG } });
      const available = await qmd.isAvailable();
      process.stdout.write(`qmd: ${available ? "available" : "not found"}\n`);
      return ctx.exit(0, null);
    });

  cli.subCommand("skills", skills as never);
});
