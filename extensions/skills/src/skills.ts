import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, copyFileSync } from "fs";
import { join, basename, resolve } from "path";
import { homedir } from "os";
import { die } from "@clip/core";
import { renderPrompt, parseSkillFile } from "./frontmatter.ts";
import {
  RESERVED_SKILL_NAMES,
  findSkillDir,
  getSkillsDir,
  loadAllSkillsSafe,
  removeSkill,
  writeSkill,
  listGroupNames,
  loadGroup,
  saveGroup,
  deleteGroup,
} from "./registry.ts";
import type { GroupDef } from "./registry.ts";

const NAME_RE = /^[a-zA-Z0-9_-]+$/;

function validateSkillName(name: string): void {
  if (!NAME_RE.test(name)) die(`Skill name may only contain letters, digits, _ and -`);
  if (RESERVED_SKILL_NAMES.has(name)) die(`"${name}" is a reserved skill name`);
}

function buildScaffold(name: string, description: string, tags: string[]): string {
  const tagLine = tags.length ? `\ntags: [${tags.map((t) => JSON.stringify(t)).join(", ")}]` : "";
  return `---
name: ${name}
description: ${JSON.stringify(description)}${tagLine}
# inputs:                     # optional — input parameter declarations
#   my_param:
#     description: parameter description
#     required: true
#   optional_param:
#     default: "default value"
---

# ${name}

<!-- Write step-by-step instructions for the agent here.
     Reference declared inputs with {{ inputs.my_param }} in the body. -->
`;
}

// --- subcommand handlers ---

async function cmdAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip skills add <name> [--description <d>] [--tag a,b]");
  validateSkillName(name);

  let description = "";
  let tags: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--description" || a === "-d") {
      description = args[++i] ?? die("--description requires a value");
    } else if (a.startsWith("--description=")) {
      description = a.slice("--description=".length);
    } else if (a === "--tag" || a === "--tags") {
      tags = (args[++i] ?? die("--tag requires a value")).split(",").map((t) => t.trim());
    } else if (a.startsWith("--tag=")) {
      tags = a.slice("--tag=".length).split(",").map((t) => t.trim());
    } else {
      die(`Unknown option: ${a}`);
    }
  }

  const skillsDir = getSkillsDir();
  const skillDir = join(skillsDir, name);
  if (existsSync(skillDir)) die(`Skill "${name}" already exists at ${skillDir}`);

  if (!description) description = `${name} skill`;

  await writeSkill(name, buildScaffold(name, description, tags));
  const skillFile = join(skillDir, "SKILL.md");
  console.log(`Created: ${skillFile}`);
  console.log(`\nEdit the skill: $EDITOR "${skillFile}"`);
  console.log(`Show it:        clip skills show ${name}`);
}

function getInstalledAgents(name: string, sourceDir: string): string[] {
  return Object.entries(AGENT_PRESETS)
    .filter(([, dir]) => {
      const marker = readMarker(dir, name);
      return marker !== null && marker.source === sourceDir;
    })
    .map(([preset]) => preset);
}

function cmdList(args: string[]): void {
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
  }

  const { entries, errors } = loadAllSkillsSafe();

  if (errors.length) {
    for (const { file, message } of errors) {
      process.stderr.write(`[error] ${file}\n  ${message}\n`);
    }
    if (!entries.length) process.exit(1);
  }

  const withAgents = entries.map((e) => ({ ...e, agents: getInstalledAgents(e.name, e.dir) }));

  if (json) {
    console.log(
      JSON.stringify(
        withAgents.map(({ name, fm, agents }) => ({
          name,
          description: fm.description,
          tags: fm.tags,
          inputs: fm.inputs,
          workflow: fm.workflow,
          installedAgents: agents,
        })),
      ),
    );
    return;
  }

  if (!entries.length) {
    console.log("No skills found.");
    console.log("\nCreate one: clip skills add <name> --description <d>");
    return;
  }

  const tty = process.stdout.isTTY;
  const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[0m` : s);
  const bold = (s: string) => (tty ? `\x1b[1m${s}\x1b[0m` : s);

  // legend: only show agents that appear in the installed skill list
  const usedAgents = [...new Set(withAgents.flatMap(({ agents }) => agents))];
  if (usedAgents.length) {
    const legend = usedAgents.map((a) => `${agentColored(a, tty)} ${a}`).join("   ");
    console.log(legend);
    console.log("");
  }

  // CJK/Hangul wide chars occupy 2 terminal columns — compensate with display width
  const charW = (ch: string) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x1100 && (cp <= 0xFFEF || (cp >= 0x20000 && cp <= 0x2FFFD) || (cp >= 0x30000 && cp <= 0x3FFFD)) ? 2 : 1;
  };
  const displayW = (s: string) => [...s].reduce((n, ch) => n + charW(ch), 0);
  const trunc = (s: string, max: number) => {
    let w = 0;
    let out = "";
    for (const ch of s) {
      const cw = charW(ch);
      if (w + cw > max - 1) return out + "…";
      out += ch;
      w += cw;
    }
    return out;
  };
  const padD = (s: string, w: number) => s + " ".repeat(Math.max(0, w - displayW(s)));

  const nameW     = Math.max(4, ...entries.map((e) => e.name.length));
  const agentColW = Math.max(6, ...withAgents.map(({ agents }) => Math.max(0, agents.length * 2 - 1)));
  const toolsW    = Math.max(5, ...withAgents.map(({ fm }) => (fm.tags ?? []).join(", ").length));
  const cols      = process.stdout.columns || 120;
  const fixedW    = nameW + agentColW + toolsW + 6; // 3 × "  " separators
  const DESC_MAX  = Math.max(11, Math.min(80, cols - fixedW));
  const descW     = Math.max(11, ...withAgents.map(({ fm }) => Math.min(displayW(fm.description), DESC_MAX)));

  const sep = (w: number) => "─".repeat(w);
  const divider = `${sep(nameW)}  ${sep(agentColW)}  ${sep(descW)}  ${sep(toolsW)}`;

  console.log(
    `${bold("NAME".padEnd(nameW))}  ${"AGENTS".padEnd(agentColW)}  ${"DESCRIPTION".padEnd(descW)}  TOOLS`,
  );
  console.log(dim(divider));

  for (const { name, fm, agents } of withAgents) {
    const rawLen = Math.max(0, agents.length * 2 - 1);
    const colored = agents.map((a) => agentColored(a, tty)).join(" ");
    const agentPadded = colored + " ".repeat(Math.max(0, agentColW - rawLen));
    const desc  = padD(trunc(fm.description, DESC_MAX), descW);
    const tools = dim((fm.tags ?? []).join(", "));
    console.log(`${name.padEnd(nameW)}  ${agentPadded}  ${desc}  ${tools}`);
  }
}

function cmdShow(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills show <name>");

  const found = findSkillDir(name);
  if (!found) die(`Skill "${name}" not found.\nRun: clip skills list`);

  const skillFile = join(found, "SKILL.md");
  const raw = readFileSync(skillFile, "utf8");
  process.stdout.write(raw);
  if (!raw.endsWith("\n")) process.stdout.write("\n");
}

function cmdGet(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills get <name> [--input k=v ...] [--json]");

  const found = findSkillDir(name);
  if (!found) die(`Skill "${name}" not found.\nRun: clip skills list`);

  const inputs: Record<string, string> = {};
  let json = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--json") {
      json = true;
    } else if (a === "--input" || a === "-i") {
      const pair = args[++i] ?? die("--input requires k=v");
      const eq = pair.indexOf("=");
      if (eq < 0) die(`--input value must be k=v, got: ${pair}`);
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else if (a.startsWith("--input=")) {
      const pair = a.slice("--input=".length);
      const eq = pair.indexOf("=");
      if (eq < 0) die(`--input value must be k=v, got: ${pair}`);
      inputs[pair.slice(0, eq)] = pair.slice(eq + 1);
    } else {
      die(`Unknown option: ${a}`);
    }
  }

  const skillFile = join(found, "SKILL.md");
  const rawSync = readFileSync(skillFile, "utf8");
  const { fm, body } = parseSkillFile(rawSync, skillFile);

  // fill defaults + check required
  const resolvedInputs = { ...inputs };
  for (const [key, def] of Object.entries(fm.inputs ?? {})) {
    if (!(key in resolvedInputs)) {
      if (def.default !== undefined) {
        resolvedInputs[key] = def.default;
      } else if (def.required) {
        die(`Missing required input: ${key}`);
      }
    }
  }

  const rendered = renderPrompt(body, resolvedInputs);

  if (json) {
    console.log(JSON.stringify({ ...fm, rendered }));
    return;
  }

  process.stdout.write(rendered);
  if (!rendered.endsWith("\n")) process.stdout.write("\n");
}

function cmdRm(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills rm <name>");

  const found = findSkillDir(name);
  if (!found) die(`Skill "${name}" not found.\nRun: clip skills list`);

  removeSkill(found);
  console.log(`Removed: ${found}`);
}

// --- install / uninstall / installed ---

const HOME = homedir();

const AGENT_PRESETS: Record<string, string> = {
  "claude-code": join(HOME, ".claude", "skills"),
  codex: join(HOME, ".codex", "skills"),
  gemini: join(HOME, ".gemini", "skills"),
  pi: join(HOME, ".pi", "agent", "skills"),
  cursor: join(HOME, ".cursor", "skills"),
};

// brand RGB colors per agent
const AGENT_COLORS: Record<string, [number, number, number]> = {
  "claude-code": [217, 119,  87], // Anthropic orange-salmon
  codex:         [ 16, 163, 127], // OpenAI green
  gemini:        [ 66, 133, 244], // Google blue
  pi:            [124,  58, 237], // Pi purple
  cursor:        [  0, 184, 217], // Cursor cyan
};

const AGENT_ICON = "✶";

function agentColored(agent: string, tty: boolean): string {
  const rgb = AGENT_COLORS[agent];
  if (!rgb || !tty) return AGENT_ICON;
  const [r, g, b] = rgb;
  return `\x1b[38;2;${r};${g};${b}m${AGENT_ICON}\x1b[0m`;
}

type InstallMode = "symlink" | "copy";

type InstallMarker = {
  source: string;
  mode: InstallMode;
  installedAt: string;
};

function markerPath(agentSkillsDir: string, name: string): string {
  return join(agentSkillsDir, `.${name}.clip-install`);
}

function readMarker(agentSkillsDir: string, name: string): InstallMarker | null {
  const mp = markerPath(agentSkillsDir, name);
  try {
    return JSON.parse(readFileSync(mp, "utf8")) as InstallMarker;
  } catch {
    return null;
  }
}

function writeMarker(agentSkillsDir: string, name: string, source: string, mode: InstallMode): void {
  const marker: InstallMarker = { source, mode, installedAt: new Date().toISOString() };
  Bun.write(markerPath(agentSkillsDir, name), JSON.stringify(marker, null, 2));
}

function removeMarker(agentSkillsDir: string, name: string): void {
  const mp = markerPath(agentSkillsDir, name);
  if (existsSync(mp)) rmSync(mp);
}

function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      copyFileSync(s, d);
    }
  }
}

function installToAgent(
  name: string,
  sourceDir: string,
  agentSkillsDir: string,
  mode: InstallMode,
  force: boolean,
): void {
  const destPath = join(agentSkillsDir, name);
  const existing = existsSync(destPath);

  if (existing) {
    const marker = readMarker(agentSkillsDir, name);
    if (!marker && !force) {
      die(`"${destPath}" exists but was not installed by clip.\nUse --force to overwrite.`);
    }
    rmSync(destPath, { recursive: true, force: true });
    removeMarker(agentSkillsDir, name);
  }

  mkdirSync(agentSkillsDir, { recursive: true });

  if (mode === "symlink") {
    symlinkSync(sourceDir, destPath);
  } else {
    copyDir(sourceDir, destPath);
  }

  writeMarker(agentSkillsDir, name, sourceDir, mode);
}

async function cmdInstall(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip skills install <name> [--to <agent>]... [--mode symlink|copy] [--force]");

  const found = findSkillDir(name);
  if (!found) die(`Skill "${name}" not found.\nRun: clip skills list`);

  const targets: string[] = [];
  let mode: InstallMode = "symlink";
  let force = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--to") {
      targets.push(args[++i] ?? die("--to requires a preset name"));
    } else if (a.startsWith("--to=")) {
      targets.push(a.slice("--to=".length));
    } else if (a === "--mode") {
      const m = args[++i] ?? die("--mode requires symlink|copy");
      if (m !== "symlink" && m !== "copy") die(`Unknown mode: "${m}". Use symlink or copy`);
      mode = m as InstallMode;
    } else if (a.startsWith("--mode=")) {
      const m = a.slice("--mode=".length);
      if (m !== "symlink" && m !== "copy") die(`Unknown mode: "${m}". Use symlink or copy`);
      mode = m as InstallMode;
    } else if (a === "--force") {
      force = true;
    } else {
      die(`Unknown option: ${a}`);
    }
  }

  if (targets.length === 0) die(`Specify at least one --to <agent>\nAvailable: ${Object.keys(AGENT_PRESETS).join(", ")}`);

  for (const preset of targets) {
    const agentSkillsDir = AGENT_PRESETS[preset];
    if (!agentSkillsDir) die(`Unknown agent preset: "${preset}"\nAvailable: ${Object.keys(AGENT_PRESETS).join(", ")}`);
    installToAgent(name, found, agentSkillsDir, mode, force);
    console.log(`  ✓ ${preset} (${mode}): ${join(agentSkillsDir, name)}`);
  }
}

function cmdUninstall(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills uninstall <name> [--from <agent>]...");

  const froms: string[] = [];
  let force = false;

  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--from") {
      froms.push(args[++i] ?? die("--from requires a preset name"));
    } else if (a.startsWith("--from=")) {
      froms.push(a.slice("--from=".length));
    } else if (a === "--force" || a === "--orphan") {
      force = true;
    } else {
      die(`Unknown option: ${a}`);
    }
  }

  // default: all presets that have this skill installed
  const targets = froms.length > 0 ? froms : Object.keys(AGENT_PRESETS);

  let removed = 0;
  for (const preset of targets) {
    const agentSkillsDir = AGENT_PRESETS[preset];
    if (!agentSkillsDir) {
      console.error(`Unknown preset: ${preset}`);
      continue;
    }
    const destPath = join(agentSkillsDir, name);
    if (!existsSync(destPath)) continue;

    const marker = readMarker(agentSkillsDir, name);
    if (!marker && !force) {
      console.error(`  ✗ ${preset}: not installed by clip (use --force to remove anyway)`);
      continue;
    }

    rmSync(destPath, { recursive: true, force: true });
    removeMarker(agentSkillsDir, name);
    console.log(`  ✓ removed from ${preset}: ${destPath}`);
    removed++;
  }

  if (removed === 0) console.log(`Skill "${name}" was not installed in any specified agent.`);
}

// --- group subcommands ---

function cmdGroupCreate(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills group create <name> [--description <d>] [skill ...]");
  if (loadGroup(name)) die(`Group "${name}" already exists.`);

  let description: string | undefined;
  const skills: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--description" || a === "-d") description = args[++i] ?? die("--description requires a value");
    else if (a.startsWith("--description=")) description = a.slice("--description=".length);
    else skills.push(a);
  }

  const def: GroupDef = { skills, ...(description ? { description } : {}) };
  saveGroup(name, def);
  console.log(`Created group "${name}"${skills.length ? ` with: ${skills.join(", ")}` : ""}`);
}

function cmdGroupList(_args: string[]): void {
  const names = listGroupNames();
  if (!names.length) {
    console.log("No groups found.\n\nCreate one: clip skills group create <name> [skill ...]");
    return;
  }
  const nameW = Math.max(5, ...names.map((n) => n.length));
  console.log(`${"GROUP".padEnd(nameW)}  SKILLS`);
  for (const n of names) {
    const g = loadGroup(n)!;
    const desc = g.description ? `  # ${g.description}` : "";
    console.log(`${n.padEnd(nameW)}  ${g.skills.join(", ") || "(empty)"}${desc}`);
  }
}

function cmdGroupShow(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills group show <name>");
  const g = loadGroup(name);
  if (!g) die(`Group "${name}" not found.`);
  console.log(`Group: ${name}${g.description ? `  — ${g.description}` : ""}`);
  if (!g.skills.length) { console.log("  (no skills)"); return; }
  for (const s of g.skills) console.log(`  • ${s}`);
}

function cmdGroupAdd(args: string[]): void {
  const [name, ...skills] = args;
  if (!name || !skills.length) die("Usage: clip skills group add <group> <skill> [skill ...]");
  const g = loadGroup(name);
  if (!g) die(`Group "${name}" not found.`);
  for (const s of skills) { if (!g.skills.includes(s)) g.skills.push(s); }
  saveGroup(name, g);
  console.log(`Updated "${name}": ${g.skills.join(", ")}`);
}

function cmdGroupRm(args: string[]): void {
  const [name, ...skills] = args;
  if (!name || !skills.length) die("Usage: clip skills group rm <group> <skill> [skill ...]");
  const g = loadGroup(name);
  if (!g) die(`Group "${name}" not found.`);
  g.skills = g.skills.filter((s) => !skills.includes(s));
  saveGroup(name, g);
  console.log(`Updated "${name}": ${g.skills.join(", ") || "(empty)"}`);
}

function cmdGroupDelete(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills group delete <name>");
  if (!deleteGroup(name)) die(`Group "${name}" not found.`);
  console.log(`Deleted group "${name}".`);
}

async function cmdGroupActivate(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip skills group activate <name> --to <agent> [--force]");
  const g = loadGroup(name);
  if (!g) die(`Group "${name}" not found.`);

  const targets: string[] = [];
  let force = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--to")               targets.push(args[++i] ?? die("--to requires a value"));
    else if (a.startsWith("--to=")) targets.push(a.slice(5));
    else if (a === "--force")       force = true;
    else die(`Unknown option: ${a}`);
  }
  if (!targets.length)
    die(`Specify at least one --to <agent>\nAvailable: ${Object.keys(AGENT_PRESETS).join(", ")}`);

  for (const preset of targets) {
    const agentSkillsDir = AGENT_PRESETS[preset];
    if (!agentSkillsDir) die(`Unknown agent: "${preset}"\nAvailable: ${Object.keys(AGENT_PRESETS).join(", ")}`);
    for (const skillName of g.skills) {
      const sourceDir = findSkillDir(skillName);
      if (!sourceDir) {
        process.stderr.write(`  ⚠ skill "${skillName}" not found in registry, skipping\n`);
        continue;
      }
      installToAgent(skillName, sourceDir, agentSkillsDir, "symlink", force);
      console.log(`  ✓ ${preset}: linked ${skillName}`);
    }
  }
}

function cmdGroupDeactivate(args: string[]): void {
  const name = args[0];
  if (!name) die("Usage: clip skills group deactivate <name> [--from <agent>] [--force]");
  const g = loadGroup(name);
  if (!g) die(`Group "${name}" not found.`);

  const froms: string[] = [];
  let force = false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--from")                froms.push(args[++i] ?? die("--from requires a value"));
    else if (a.startsWith("--from="))  froms.push(a.slice(7));
    else if (a === "--force")          force = true;
    else die(`Unknown option: ${a}`);
  }
  const targets = froms.length ? froms : Object.keys(AGENT_PRESETS);

  for (const preset of targets) {
    const agentSkillsDir = AGENT_PRESETS[preset];
    if (!agentSkillsDir) { process.stderr.write(`Unknown preset: ${preset}\n`); continue; }
    for (const skillName of g.skills) {
      const destPath = join(agentSkillsDir, skillName);
      if (!existsSync(destPath)) continue;
      const marker = readMarker(agentSkillsDir, skillName);
      if (!marker && !force) {
        process.stderr.write(`  ✗ ${preset}/${skillName}: not installed by clip (use --force)\n`);
        continue;
      }
      rmSync(destPath, { recursive: true, force: true });
      removeMarker(agentSkillsDir, skillName);
      console.log(`  ✓ ${preset}: unlinked ${skillName}`);
    }
  }
}

async function cmdGroup(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "create":     cmdGroupCreate(rest); break;
    case "list":       cmdGroupList(rest); break;
    case "show":       cmdGroupShow(rest); break;
    case "add":        cmdGroupAdd(rest); break;
    case "rm":
    case "remove":     cmdGroupRm(rest); break;
    case "delete":     cmdGroupDelete(rest); break;
    case "activate":   await cmdGroupActivate(rest); break;
    case "deactivate": cmdGroupDeactivate(rest); break;
    default:
      die(
        [
          "Usage: clip skills group <subcommand>",
          "",
          "  create <name> [skill ...]               Create a group",
          "  list                                    List all groups  (groups.yml)",
          "  show <name>                             Show skills in group",
          "  add <name> <skill> [skill ...]          Add skills to group",
          "  rm <name> <skill> [skill ...]           Remove skills from group",
          "  delete <name>                           Delete group definition",
          "  activate <name> --to <agent> [--force]  Symlink group skills to agent",
          "  deactivate <name> [--from <agent>]      Remove group symlinks from agent",
          "",
          `Agent presets: ${Object.keys(AGENT_PRESETS).join(", ")}`,
        ].join("\n"),
      );
  }
}

// --- pull command ---

async function cmdPull(args: string[]): Promise<void> {
  const srcArg = args[0];
  if (!srcArg) die("Usage: clip skills pull <path> [<name>]");

  const srcPath = resolve(srcArg);
  if (!existsSync(srcPath)) die(`Path not found: ${srcPath}`);
  if (!existsSync(join(srcPath, "SKILL.md"))) die(`No SKILL.md found in: ${srcPath}`);

  const name = args[1] ?? basename(srcPath);
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) die(`Invalid skill name: "${name}"`);

  const destDir = join(getSkillsDir(), name);
  if (existsSync(destDir)) die(`Skill "${name}" already exists in registry.\nUse --force to overwrite (not yet supported).`);

  // move srcPath → registry
  mkdirSync(getSkillsDir(), { recursive: true });
  try {
    renameSync(srcPath, destDir);
  } catch (e: unknown) {
    // cross-device: fallback to copy + remove
    if ((e as NodeJS.ErrnoException).code === "EXDEV") {
      copyDir(srcPath, destDir);
      rmSync(srcPath, { recursive: true, force: true });
    } else {
      throw e;
    }
  }

  // reverse symlink at original path
  symlinkSync(destDir, srcPath);

  console.log(`Pulled: ${srcPath}`);
  console.log(`  → registry: ${destDir}`);
  console.log(`  → symlink:  ${srcPath} → ${destDir}`);
}

// --- routing ---

export async function runSkillsCmd(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "add":
      await cmdAdd(rest);
      break;
    case "list":
      cmdList(rest);
      break;
    case "show":
      cmdShow(rest);
      break;
    case "get":
      cmdGet(rest);
      break;
    case "rm":
    case "remove":
      cmdRm(rest);
      break;
    case "install":
      await cmdInstall(rest);
      break;
    case "uninstall":
      cmdUninstall(rest);
      break;
    case "group":
      await cmdGroup(rest);
      break;
    case "pull":
      await cmdPull(rest);
      break;
    default:
      die(
        [
          "Usage: clip skills <subcommand> [args]",
          "",
          "Registry:",
          "  add <name>                        Create a new skill scaffold",
          "  pull <path> [<name>]              Move external skill into registry + leave symlink",
          "  list [--json]                     List all skills",
          "  show <name>                       Print SKILL.md verbatim",
          "  get <name> [--input k=v ...]      Render skill with inputs substituted",
          "  rm <name>                         Remove from registry",
          "",
          "Agent install:",
          "  install <name> --to <agent> ...   Install to agent (symlink by default)",
          "  uninstall <name> [--from <agent>] Remove from agent",
          "",
          "Groups  (~/.clip/skills/groups.yml):",
          "  group create <name> [skill ...]   Create a group",
          "  group list                        List all groups",
          "  group activate <name> --to <agent>   Symlink group skills to agent",
          "  group deactivate <name>           Remove group symlinks from agent",
          "  group add/rm/show/delete ...      Manage group contents",
          "",
          `Agent presets: ${Object.keys(AGENT_PRESETS).join(", ")}`,
        ].join("\n"),
      );
  }
}
