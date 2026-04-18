import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { die } from "./errors.ts";
import { loadConfig } from "./config.ts";

const HOME = homedir();
const MARKER_START = "<!-- clip:start -->";
const MARKER_END = "<!-- clip:end -->";

// --- 경로 상수 ---

const CLAUDE_HOOKS_DIR  = join(HOME, ".clip", "hooks");
const CLAUDE_HOOK_SCRIPT = join(CLAUDE_HOOKS_DIR, "check-clip.sh");
const CLAUDE_SETTINGS   = join(HOME, ".claude", "settings.json");
const CLAUDE_MD         = join(HOME, ".claude", "CLAUDE.md");
const AGENTS_SKILL_DIR  = join(HOME, ".agents", "skills", "clip");  // canonical

const CODEX_SKILL_LINK  = join(HOME, ".codex", "skills", "clip");

const GEMINI_MD         = join(HOME, ".gemini", "GEMINI.md");
const GEMINI_SKILL_LINK = join(HOME, ".gemini", "skills", "clip");

const PI_AGENTS_MD      = join(HOME, ".pi", "agent", "AGENTS.md");
const PI_SKILL_LINK     = join(HOME, ".pi", "agent", "skills", "clip");

// --- 공통 빌더 ---

function buildSkillMd(targetNames: string[]): string {
  const targetList = targetNames.map((n) => `\`${n}\``).join(", ");
  return `---
name: clip
description: CLI proxy gateway for third-party tools (${targetList}). Use when managing clip targets or when you need to run infrastructure CLIs. Always run registered targets through clip instead of directly.
---

# clip — CLI Proxy Gateway

## 규칙
- 외부 서비스 CLI는 반드시 \`clip\`을 통해 실행
  - \`gh topic describe\` ✗ → \`clip gh topic describe\` ✓
- 시스템 CLI(\`grep\`, \`jq\`)와 개발 도구(\`bun\`, \`npm\`, \`git\`)는 직접 실행

## 등록된 target
${targetNames.map((n) => `- \`${n}\``).join("\n")}

## 사용법
- \`clip <target> <subcommand> [...args]\` — 명령 실행
- \`clip list\` — 등록된 target 목록
- \`clip <target> --help\` — target 도움말 + ACL 규칙
- \`clip add <name> <command-or-url>\` — 새 target 등록
`;
}

function buildInstructionSection(targetNames: string[]): string {
  const examples = targetNames
    .slice(0, 2)
    .map((n) => `  - \`${n} ...\` ✗ → \`clip ${n} ...\` ✓`)
    .join("\n");
  return `${MARKER_START}

## clip 게이트웨이
- 외부 서비스 CLI(${targetNames.map((n) => `\`${n}\``).join(", ")} 등)는 반드시 \`clip\`을 통해 실행:
${examples}
- \`clip list\`로 등록된 target 확인
- ACL 설정: \`~/.clip/settings.yml\`
- 시스템 CLI(\`grep\`, \`jq\`)와 개발 도구(\`bun\`, \`npm\`, \`git\`)는 직접 실행

${MARKER_END}`;
}

/** 마커 기반 섹션 upsert — idempotent */
async function upsertSection(filePath: string, section: string): Promise<void> {
  const file = Bun.file(filePath);
  let content = (await file.exists()) ? await file.text() : "";
  if (content.includes(MARKER_START)) {
    const re = new RegExp(`${MARKER_START}[\\s\\S]*?${MARKER_END}`);
    content = content.replace(re, section);
  } else {
    content = `${content.trimEnd()}\n\n${section}\n`;
  }
  await Bun.write(filePath, content);
}

async function writeSkill(skillDir: string, targetNames: string[]): Promise<void> {
  await Bun.spawn(["mkdir", "-p", skillDir]).exited;
  await Bun.write(join(skillDir, "SKILL.md"), buildSkillMd(targetNames));
}

/** agent-specific skill 경로를 ~/.agents/skills/clip 심볼릭 링크로 연결 (idempotent) */
function linkAgentSkill(linkPath: string): void {
  let exists = false;
  let isSymlink = false;
  try {
    const stat = lstatSync(linkPath);
    exists = true;
    isSymlink = stat.isSymbolicLink();
  } catch { /* not found */ }

  if (exists) {
    if (isSymlink && readlinkSync(linkPath) === AGENTS_SKILL_DIR) return;
    rmSync(linkPath, { recursive: true, force: true });
  }

  mkdirSync(join(linkPath, ".."), { recursive: true });
  symlinkSync(AGENTS_SKILL_DIR, linkPath);
}

// --- 에이전트별 install ---

async function installClaudeCode(targetNames: string[]): Promise<void> {
  // Hook 스크립트
  await Bun.spawn(["mkdir", "-p", CLAUDE_HOOKS_DIR]).exited;
  const pattern = targetNames.join("|");
  const hookScript = `#!/bin/bash
command=$(cat | jq -r '.tool_input.command // ""')
first_word=$(echo "$command" | awk '{print $1}')
case "$first_word" in
  ${pattern})
    echo "hint: use \\"clip $command\\" instead of calling \\"$first_word\\" directly." >&2
    exit 1
    ;;
esac
exit 0
`;
  await Bun.write(CLAUDE_HOOK_SCRIPT, hookScript);
  await Bun.spawn(["chmod", "+x", CLAUDE_HOOK_SCRIPT]).exited;
  console.log(`  ✓ hook script: ${CLAUDE_HOOK_SCRIPT}`);

  // settings.json PreToolUse
  const settingsFile = Bun.file(CLAUDE_SETTINGS);
  if (!(await settingsFile.exists())) die(`settings.json not found: ${CLAUDE_SETTINGS}`);
  const settings = JSON.parse(await settingsFile.text());
  settings.hooks ??= {};
  settings.hooks.PreToolUse = [
    { matcher: "Bash", hooks: [{ type: "command", command: CLAUDE_HOOK_SCRIPT, timeout: 5 }] },
  ];
  await Bun.write(CLAUDE_SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`  ✓ hook: ${CLAUDE_SETTINGS}`);

  // CLAUDE.md
  await upsertSection(CLAUDE_MD, buildInstructionSection(targetNames));
  console.log(`  ✓ instructions: ${CLAUDE_MD}`);

  // Skill (~/.claude/skills/ → ~/.agents/skills/ 체인 경유)
  await writeSkill(AGENTS_SKILL_DIR, targetNames);
  console.log(`  ✓ skill: ${AGENTS_SKILL_DIR}/SKILL.md`);

  console.log("  → Reload Claude Code to apply the hook.");
}

async function installCodex(targetNames: string[]): Promise<void> {
  await writeSkill(AGENTS_SKILL_DIR, targetNames);
  linkAgentSkill(CODEX_SKILL_LINK);
  console.log(`  ✓ skill: ${AGENTS_SKILL_DIR}/SKILL.md`);
  console.log(`  ✓ symlink: ${CODEX_SKILL_LINK} → ${AGENTS_SKILL_DIR}`);
}

async function installGemini(targetNames: string[]): Promise<void> {
  // GEMINI.md
  await upsertSection(GEMINI_MD, buildInstructionSection(targetNames));
  console.log(`  ✓ instructions: ${GEMINI_MD}`);

  // Skill
  await writeSkill(AGENTS_SKILL_DIR, targetNames);
  linkAgentSkill(GEMINI_SKILL_LINK);
  console.log(`  ✓ skill: ${AGENTS_SKILL_DIR}/SKILL.md`);
  console.log(`  ✓ symlink: ${GEMINI_SKILL_LINK} → ${AGENTS_SKILL_DIR}`);
  console.log("  → Run: gemini skills install ~/.gemini/skills/clip --scope user");
}

async function installPi(targetNames: string[]): Promise<void> {
  // AGENTS.md
  await upsertSection(PI_AGENTS_MD, buildInstructionSection(targetNames));
  console.log(`  ✓ instructions: ${PI_AGENTS_MD}`);

  // Skill
  await writeSkill(AGENTS_SKILL_DIR, targetNames);
  linkAgentSkill(PI_SKILL_LINK);
  console.log(`  ✓ skill: ${AGENTS_SKILL_DIR}/SKILL.md`);
  console.log(`  ✓ symlink: ${PI_SKILL_LINK} → ${AGENTS_SKILL_DIR}`);
}

// --- 라우팅 ---

const INTEGRATIONS = {
  "claude-code": installClaudeCode,
  "codex": installCodex,
  "gemini": installGemini,
  "pi": installPi,
} as const;

type Integration = keyof typeof INTEGRATIONS;

export async function runSkillsCmd(args: string[]): Promise<void> {
  const sub = args[0];
  if (sub !== "add") {
    die(`Usage: clip skills add <integration>\nAvailable: ${Object.keys(INTEGRATIONS).join(", ")}`);
  }

  const integration = args[1] as Integration | undefined;
  if (!integration) {
    die(`Usage: clip skills add <integration>\nAvailable: ${Object.keys(INTEGRATIONS).join(", ")}`);
  }
  if (!(integration in INTEGRATIONS)) {
    die(`Unknown integration: "${integration}"\nAvailable: ${Object.keys(INTEGRATIONS).join(", ")}`);
  }

  const config = await loadConfig();
  const targetNames = [...Object.keys(config.cli), ...Object.keys(config.mcp)];
  if (targetNames.length === 0) {
    console.log("warning: no targets registered yet. Run `clip add <name> <command>` first.\n");
  }

  console.log(`Installing clip integration for ${integration}...`);
  await INTEGRATIONS[integration](targetNames);
  console.log("\nDone.");
}
