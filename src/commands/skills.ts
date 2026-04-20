import { lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { loadConfig } from "../config.ts";
import { die } from "../utils/errors.ts";

const HOME = homedir();
const MARKER_START = "<!-- clip:start -->";
const MARKER_END = "<!-- clip:end -->";

// --- 경로 상수 ---

const CLAUDE_HOOKS_DIR = join(HOME, ".clip", "hooks");
const CLAUDE_HOOK_SCRIPT = join(CLAUDE_HOOKS_DIR, "check-clip.sh");
const CLAUDE_SETTINGS = join(HOME, ".claude", "settings.json");
const CLAUDE_MD = join(HOME, ".claude", "CLAUDE.md");
const AGENTS_SKILL_DIR = join(HOME, ".agents", "skills", "clip"); // canonical

const CODEX_SKILL_LINK = join(HOME, ".codex", "skills", "clip");

const GEMINI_MD = join(HOME, ".gemini", "GEMINI.md");
const GEMINI_SKILL_LINK = join(HOME, ".gemini", "skills", "clip");

const PI_AGENTS_MD = join(HOME, ".pi", "agent", "AGENTS.md");
const PI_SKILL_LINK = join(HOME, ".pi", "agent", "skills", "clip");

// --- 공통 빌더 ---

function buildSkillMd(targetNames: string[]): string {
  const targetList = targetNames.map((n) => `\`${n}\``).join(", ");
  return `---
name: clip
description: CLI proxy gateway for third-party tools (${targetList}). Always route registered targets through clip instead of calling them directly.
---

# clip — CLI Proxy Gateway

## 최우선 원칙
- 외부 서비스는 \`clip list\` 사전 조회 없이 **\`clip <target> <tool>\` 바로 실행**.
- block(인증 오류·target 없음 등) 발생 시에만 \`clip list\` → \`clip <target> tools\` 순서로 탐색.
- "Claude Code에 직접 연결된 MCP 목록"만 보고 "없음"이라 답하지 말 것.

## 규칙
- 외부 서비스 CLI·MCP는 반드시 \`clip\`을 통해 실행
  - \`gh topic describe\` ✗ → \`clip gh topic describe\` ✓
- 시스템 CLI(\`grep\`, \`jq\`)와 개발 도구(\`bun\`, \`npm\`)는 직접 실행
- \`bind\`는 opt-in: \`clip bind <target>\` 이전에는 항상 \`clip\` 접두어를 붙여 실행

## 등록된 target
${targetNames.map((n) => `- \`${n}\``).join("\n")}

## 사용법
- 실행 — \`clip <target> <sub> [...args]\`
- 목록 — \`clip list\`
  - \`[cli] / [mcp]\` 타입 태그, \`[bind]\` = shim 활성, \`[authenticated] / [expiring] / [not authenticated]\` = HTTP MCP OAuth 상태
- 도움말·ACL — \`clip <target> --help\`
- MCP 도구 목록 — \`clip <target> tools\`
- 등록 — \`clip add <name> <cmd-or-url>\` (HTTP MCP는 URL, STDIO MCP는 \`--stdio <cmd> [args...]\`)
- 해제 — \`clip remove <name>\`
- 인증 — \`clip login <target>\` / \`clip logout <target>\` (HTTP MCP만)
- Bind — \`clip bind <target>\` / \`clip unbind <target>\` / \`clip binds\` (shim: \`~/.clip/bin/\`)
`;
}

function buildInstructionSection(targetNames: string[]): string {
  const examples = targetNames
    .slice(0, 2)
    .map((n) => `  - \`${n} ...\` ✗ → \`clip ${n} ...\` ✓`)
    .join("\n");
  return `${MARKER_START}

## clip 게이트웨이
- 외부 서비스 CLI·MCP(${targetNames.map((n) => `\`${n}\``).join(", ")} 등)는 반드시 \`clip\`을 통해 실행:
${examples}
- **실행 우선**: 사전 조회 없이 \`clip <target> <tool>\` 바로 실행. block 시 \`clip list\`·\`clip <target> tools\`로 탐색
- \`clip list\`로 등록된 target 확인, 개별 target 설정은 해당 target 디렉터리의 \`config.yml\`
- 시스템 CLI(\`grep\`, \`jq\`)와 개발 도구(\`bun\`, \`npm\`)는 직접 실행

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
  } catch {
    /* not found */
  }

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
  codex: installCodex,
  gemini: installGemini,
  pi: installPi,
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
  const targetNames = [
    ...Object.keys(config.cli),
    ...Object.keys(config.mcp),
    ...Object.keys(config.api),
    ...Object.keys(config.grpc),
    ...Object.keys(config.graphql),
    ...Object.keys(config.script),
  ];
  if (targetNames.length === 0) {
    console.log("warning: no targets registered yet. Run `clip add <name> <command>` first.\n");
  }

  console.log(`Installing clip integration for ${integration}...`);
  await INTEGRATIONS[integration](targetNames);
  console.log("\nDone.");
}
