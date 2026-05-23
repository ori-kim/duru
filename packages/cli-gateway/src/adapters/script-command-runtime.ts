import type { GatewayTargetHelpDocument } from "../help";
import type { GatewayInvokeContext, GatewayResult, GatewayTool } from "../types";
import type { ScriptCommandConfig, ScriptCommandsConfig } from "./script";

export async function executeScriptCommandTarget(
  config: ScriptCommandsConfig,
  ctx: GatewayInvokeContext,
  target: string,
): Promise<GatewayResult> {
  const command = ctx.argv[0];
  if (!command || command === "tools") return { ok: true, value: scriptCommandTools(config), exitCode: 0 };
  if (command === "--help" || command === "-h") return scriptTargetHelp(config, target);
  if (command === "types") return { ok: true, value: [], exitCode: 0 };
  if (command === "describe") return describeScriptCommand(config, ctx.argv[1]);

  const definition = config.commands[command];
  if (!definition) return { ok: false, error: { message: `Unknown script command: "${command}"` }, exitCode: 2 };
  if (ctx.argv.slice(1).some((arg) => arg === "--help" || arg === "-h")) {
    return { ok: true, value: scriptCommandHelp(command, definition), exitCode: 0 };
  }

  return runScriptCommand(config, command, definition, ctx);
}

export function scriptCommandTools(config: ScriptCommandsConfig): readonly GatewayTool[] {
  return Object.entries(config.commands)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, command]) => ({
      name,
      ...(command.description ? { description: command.description } : {}),
    }));
}

export function scriptCommandsSummary(config: ScriptCommandsConfig): string {
  const count = Object.keys(config.commands).length;
  return config.description ?? `${count} command${count === 1 ? "" : "s"}`;
}

function scriptTargetHelp(config: ScriptCommandsConfig, target: string): GatewayResult {
  const value: GatewayTargetHelpDocument = {
    target,
    type: "script",
    usage: `${target} <command>`,
    operations: [
      { name: "tools", description: "List script commands" },
      { name: "describe <command>", description: "Describe a script command" },
      { name: "types", description: "List script target types" },
      ...scriptCommandTools(config),
    ],
  };
  return { ok: true, value, exitCode: 0 };
}

function describeScriptCommand(config: ScriptCommandsConfig, name: string | undefined): GatewayResult {
  if (!name) return { ok: false, error: { message: "describe requires a command name" }, exitCode: 2 };
  const tool = scriptCommandTools(config).find((item) => item.name === name);
  if (!tool) return { ok: false, error: { message: `Unknown script command: "${name}"` }, exitCode: 2 };
  return { ok: true, value: tool, exitCode: 0 };
}

async function runScriptCommand(
  config: ScriptCommandsConfig,
  name: string,
  definition: ScriptCommandConfig,
  ctx: GatewayInvokeContext,
): Promise<GatewayResult> {
  const args = scriptCommandArgs(definition, ctx.argv.slice(1));
  const argv = definition.file
    ? [definition.file, ...args]
    : ["bash", "-c", definition.script ?? "", `duru-${name}`, ...args];
  const env = { ...Bun.env, ...(config.env ?? {}), ...(definition.env ?? {}) };

  if (ctx.dryRun) {
    return {
      ok: true,
      value: { command: argv, ...(config.cwd ? { cwd: config.cwd } : {}), env: redactedEnv(definition.env) },
      exitCode: 0,
    };
  }

  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      env,
    });
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 127 };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode === 0) return { ok: true, value: stripFinalNewline(stdout), exitCode };
  return {
    ok: false,
    error: {
      message: stripFinalNewline(stderr || stdout) || `Script failed with exit code ${exitCode}`,
      stdout: stripFinalNewline(stdout),
      stderr: stripFinalNewline(stderr),
    },
    exitCode,
  };
}

function scriptCommandArgs(definition: ScriptCommandConfig, argv: readonly string[]): readonly string[] {
  if (!definition.args?.length || argv.length !== 1 || !argv[0]?.startsWith("{")) return argv;

  const input = parseJsonObject(argv[0]);
  if (!input) return argv;

  return definition.args.map((name) => stringArg(input[name]));
}

function scriptCommandHelp(name: string, definition: ScriptCommandConfig): string {
  const lines = [`Command: ${name}`];
  if (definition.description) lines.push(definition.description);
  if (definition.args?.length) lines.push(`Usage: ${name} ${definition.args.map((arg) => `<${arg}>`).join(" ")}`);
  if (definition.file) lines.push(`File: ${definition.file}`);
  return `${lines.join("\n")}\n`;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringArg(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function redactedEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  return env ? Object.fromEntries(Object.keys(env).map((key) => [key, "<redacted>"])) : undefined;
}

function stripFinalNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
