#!/usr/bin/env bun
import { checkAcl } from "./acl.ts";
import { executeCli } from "./cli-target.ts";
import type { CliTarget, McpTarget } from "./config.ts";
import { CONFIG_DIR, addTarget, getTarget, loadConfig, removeTarget } from "./config.ts";
import { die } from "./errors.ts";
import { executeMcp } from "./mcp-target.ts";
import { forceLogin, getAuthStatus, removeTokens } from "./oauth.ts";
import { formatOutput } from "./output.ts";
import { runSkillsCmd } from "./skills.ts";

const VERSION = "0.1.0";

const HELP = `
clip — CLI proxy for MCP servers and CLI tools

Usage:
  clip [--json] [--pipe] <target> <subcommand> [...args]
  clip add <name> <command-or-url> [--allow x,y] [--deny z]
  clip remove <name>
  clip list
  clip login <target>
  clip logout <target>
  clip <target> tools
  clip <target> --help

Global flags:
  --json        Output as JSON (unwraps MCP content, wraps CLI stdout)
  --pipe        Force buffered mode even in a TTY (disables passthrough)
  --help, -h    Show this help
  --version, -v Show version

Config:
  ${CONFIG_DIR}/settings.{yml,json}

OAuth tokens:
  ~/.clip/mcp/<target>/auth.json

Examples:
  clip add gh gh --deny delete,apply
  clip add notion https://mcp.notion.com/mcp
  clip add linear https://mcp.linear.app/mcp
  clip login notion      # OAuth 인증
  clip logout notion     # 토큰 삭제
  clip list
  clip notion tools
  clip --json gh pr list
  clip gh get pods -n default

Tree ACL (settings.yml 직접 편집):
  cli:
    gh:
      command: gh
      acl:
        topic:
          allow: [describe, list]
        group:
          deny: [delete]

Agent integration:
  clip skills add claude-code
`.trim();

// --- argv 수동 파싱 ---
// clip [글로벌 플래그...] <target> <subcommand> [...target-args]
// 글로벌 플래그는 앞에서만 소비하고, target 이름 이후는 전부 passthrough

function parseGlobalFlags(argv: string[]): {
  jsonMode: boolean;
  pipeMode: boolean;
  configPath: string | undefined;
  rest: string[];
} {
  let jsonMode = false;
  let pipeMode = false;
  let configPath: string | undefined;
  let i = 0;

  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--json") {
      jsonMode = true;
      i++;
    } else if (a === "--pipe") {
      pipeMode = true;
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--version" || a === "-v") {
      console.log(`clip ${VERSION}`);
      process.exit(0);
    } else if ((a === "--config" || a === "-c") && argv[i + 1]) {
      configPath = argv[++i];
      i++;
    } else {
      break; // 첫 비플래그 인자 = target 이름
    }
  }

  return { jsonMode, pipeMode, configPath, rest: argv.slice(i) };
}

// --- list / add / remove ---

function formatAcl(target: CliTarget | McpTarget): string {
  const parts: string[] = [];
  if (target.allow && target.allow.length > 0) parts.push(`allow: ${target.allow.join(",")}`);
  if (target.deny && target.deny.length > 0) parts.push(`deny: ${target.deny.join(",")}`);
  if (target.acl) {
    const keys = Object.keys(target.acl);
    parts.push(`acl: [${keys.join(",")}]`);
  }
  return parts.length > 0 ? `  (${parts.join("  ")})` : "";
}

async function runList(): Promise<void> {
  const config = await loadConfig();
  const cliEntries = Object.entries(config.cli);
  const mcpEntries = Object.entries(config.mcp);

  if (cliEntries.length === 0 && mcpEntries.length === 0) {
    console.log("No targets configured.");
    console.log(`\nAdd one:\n  clip add <name> <command>          # CLI tool`);
    console.log(`  clip add <name> <https://...>      # MCP server`);
    return;
  }

  console.log("Targets:");
  for (const [name, b] of [...cliEntries].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  ${name.padEnd(16)} [cli] ${b.command}${formatAcl(b)}`);
  }
  for (const [name, b] of [...mcpEntries].sort(([a], [b]) => a.localeCompare(b))) {
    const authStatus = await getAuthStatus(name);
    const statusTag = authStatus ? `  [${authStatus}]` : "  [not authenticated]";
    console.log(`  ${name.padEnd(16)} [mcp] ${b.url}${formatAcl(b)}${statusTag}`);
  }
}

async function runAdd(args: string[]): Promise<void> {
  const name = args[0];
  if (!name || name.startsWith("--")) {
    die("Usage: clip add <name> <command-or-url> [--allow x,y] [--deny z]");
  }

  // 두 번째 positional (플래그가 아닌 것) 수집
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1] ?? "";
      if (val && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = "true";
      }
    } else {
      positionals.push(a);
    }
  }

  const allow = flags["allow"] ? flags["allow"].split(",").map((s) => s.trim()) : undefined;
  const deny = flags["deny"] ? flags["deny"].split(",").map((s) => s.trim()) : undefined;

  // 타입 결정: --type 명시 > --url/--command 명시 > positional 자동 감지
  let type = flags["type"] as "mcp" | "cli" | undefined;
  if (!type && flags["url"]) type = "mcp";
  if (!type && flags["command"]) type = "cli";
  if (!type && positionals[0]) {
    type = positionals[0].startsWith("http://") || positionals[0].startsWith("https://") ? "mcp" : "cli";
  }
  if (!type) die("Cannot detect type. Provide <command-or-url> or --type mcp|cli");

  if (type === "mcp") {
    const url = flags["url"] ?? positionals[0];
    if (!url) die("MCP target requires a URL (e.g. clip add myserver https://...mcp)");
    await addTarget(name, "mcp", { url, allow, deny });
    console.log(`Added MCP target "${name}" → ${url}`);
  } else {
    const command = flags["command"] ?? positionals[0];
    if (!command) die("CLI target requires a command (e.g. clip add gh gh)");
    const prependArgs = flags["args"] ? flags["args"].split(",").map((s) => s.trim()) : undefined;
    await addTarget(name, "cli", { command, args: prependArgs, allow, deny });
    console.log(`Added CLI target "${name}" → ${command}`);
  }
}

async function runRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip remove <name>");
  await removeTarget(name);
  console.log(`Removed target "${name}".`);
}

// --- config 서브커맨드 (하위 호환) ---

async function runConfigCmd(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "list") return runList();
  if (sub === "add") return runAdd(args.slice(1));
  if (sub === "remove") return runRemove(args.slice(1));
  die(`Unknown config subcommand: "${sub}"\nUsage: clip config list|add|remove`);
}

// --- target help ---

async function printTargetHelp(name: string, type: "cli" | "mcp", target: CliTarget | McpTarget): Promise<void> {
  const detail = type === "mcp"
    ? `MCP server: ${(target as McpTarget).url}`
    : `CLI command: ${(target as CliTarget).command}`;
  console.log(`clip ${name} — ${detail}`);
  console.log(`\nUsage: clip ${name} <subcommand> [...args]`);

  if (target.allow && target.allow.length > 0) {
    console.log(`\nAllowed: ${target.allow.join(", ")}`);
  }
  if (target.deny && target.deny.length > 0) {
    console.log(`Denied:  ${target.deny.join(", ")}`);
  }
  if (target.acl) {
    console.log("\nACL tree:");
    for (const [sub, node] of Object.entries(target.acl)) {
      const parts: string[] = [];
      if (node.allow?.length) parts.push(`allow: ${node.allow.join(", ")}`);
      if (node.deny?.length) parts.push(`deny: ${node.deny.join(", ")}`);
      console.log(`  ${sub}: ${parts.join("  ") || "(unrestricted)"}`);
    }
  }
  if (!target.allow?.length && !target.deny?.length && !target.acl) {
    console.log(`\nNo ACL restrictions.`);
  }

  if (type === "mcp") {
    console.log(`\nRun: clip ${name} tools  — to list available tools`);
  }

  // 원래 명령의 --help 출력도 표시
  if (type === "cli") {
    const cli = target as CliTarget;
    const proc = Bun.spawn([cli.command, ...(cli.args ?? []), "--help"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...(cli.env ?? {}) } as Record<string, string>,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    ]);
    const helpText = (stdout || stderr).trim();
    if (helpText) {
      console.log(`\n--- ${cli.command} --help ---\n`);
      console.log(helpText);
    }
  }
}

// --- 메인 ---

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const { jsonMode, pipeMode, rest } = parseGlobalFlags(argv);
  const passthrough = !!process.stdout.isTTY && !jsonMode && !pipeMode;

  if (rest.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const targetName = rest[0]!;

  // 내장 명령
  if (targetName === "config") { await runConfigCmd(rest.slice(1)); return; }
  if (targetName === "list") { await runList(); return; }
  if (targetName === "add") { await runAdd(rest.slice(1)); return; }
  if (targetName === "remove") { await runRemove(rest.slice(1)); return; }
  if (targetName === "skills") { await runSkillsCmd(rest.slice(1)); return; }

  if (targetName === "login") {
    const name = rest[1];
    if (!name) die("Usage: clip login <target>");
    const cfg = await loadConfig();
    const { type, target } = getTarget(cfg, name);
    if (type !== "mcp") die(`"${name}" is not an MCP target. OAuth only applies to MCP targets.`);
    await forceLogin(name, (target as McpTarget).url);
    return;
  }

  if (targetName === "logout") {
    const name = rest[1];
    if (!name) die("Usage: clip logout <target>");
    await removeTokens(name);
    console.log(`Logged out of "${name}".`);
    return;
  }

  const config = await loadConfig();
  const resolved = getTarget(config, targetName);
  const { type, target } = resolved;

  const subcommand = rest[1];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    await printTargetHelp(targetName, type, target);
    process.exit(0);
  }

  const targetArgs = rest.slice(2);

  // ACL 체크 제외: 내장 명령(tools) + --help in args
  const hasHelpFlag = targetArgs.includes("--help") || targetArgs.includes("-h");
  if (subcommand !== "tools" && !hasHelpFlag) {
    checkAcl(target, subcommand, targetArgs[0], targetName);
  }

  if (type === "mcp") {
    const result = await executeMcp(target as McpTarget, config.headers, subcommand, targetArgs, targetName);
    formatOutput(result, jsonMode ? "json" : "plain", "mcp");
  } else {
    const result = await executeCli(target as CliTarget, subcommand, targetArgs, passthrough);
    if (!passthrough) formatOutput(result, jsonMode ? "json" : "plain", "cli");
    else process.exit(result.exitCode);
  }
}

main().catch((e: unknown) => {
  die(String(e));
});
