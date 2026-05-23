import type { AddInput, GatewayAdapter, GatewayInvokeContext, GatewayResult } from "../types";
import { executeScriptCommandTarget, scriptCommandTools, scriptCommandsSummary } from "./script-command-runtime";

export type ScriptAdapterConfig = ScriptProcessConfig | ScriptCommandsConfig;

export type ScriptProcessConfig = {
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: Record<string, string>;
};

export type ScriptCommandsConfig = {
  description?: string;
  commands: Record<string, ScriptCommandConfig>;
  cwd?: string;
  env?: Record<string, string>;
};

export type ScriptCommandConfig = {
  script?: string;
  file?: string;
  description?: string;
  args?: readonly string[];
  env?: Record<string, string>;
};

export function scriptAdapter(): GatewayAdapter<ScriptAdapterConfig> {
  return {
    type: "script",
    schema: { parse: parseScriptConfig },
    async add(input) {
      return scriptConfigFromAddInput(input);
    },
    createTarget({ manifest, config }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return executeScriptTarget(config, ctx, manifest.name);
        },
        async catalog() {
          return isScriptCommandsConfig(config) ? scriptCommandTools(config) : [];
        },
        listRow() {
          return {
            name: manifest.name,
            type: "script",
            summary: isScriptCommandsConfig(config) ? scriptCommandsSummary(config) : config.command,
          };
        },
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function scriptConfigFromAddInput(input: AddInput): ScriptAdapterConfig {
  if (input.argv.length === 0) {
    const description = stringOption(input.options?.description);
    return {
      ...(description ? { description } : {}),
      commands: {},
    };
  }

  const command = input.argv[0] ?? input.name;
  return {
    command,
    args: input.argv.slice(1),
  };
}

function parseScriptConfig(value: unknown): ScriptAdapterConfig {
  if (isRecord(value) && value.commands !== undefined) return parseScriptCommandsConfig(value);

  if (!isRecord(value) || typeof value.command !== "string" || value.command.length === 0) {
    throw new Error("Invalid script target config: command is required");
  }

  if (value.args !== undefined && !isStringArray(value.args)) {
    throw new Error("Invalid script target config: args must be a string array");
  }

  if (value.cwd !== undefined && typeof value.cwd !== "string") {
    throw new Error("Invalid script target config: cwd must be a string");
  }

  if (value.env !== undefined && !isStringRecord(value.env)) {
    throw new Error("Invalid script target config: env must be a string record");
  }

  return {
    command: value.command,
    args: value.args,
    ...(value.cwd ? { cwd: value.cwd } : {}),
    ...(value.env ? { env: value.env } : {}),
  };
}

function parseScriptCommandsConfig(value: Record<string, unknown>): ScriptCommandsConfig {
  if (!isRecord(value.commands)) {
    throw new Error("Invalid script target config: commands must be a record");
  }

  const commands: Record<string, ScriptCommandConfig> = {};
  for (const [name, command] of Object.entries(value.commands)) {
    commands[name] = parseScriptCommandConfig(name, command);
  }

  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error("Invalid script target config: description must be a string");
  }

  if (value.cwd !== undefined && typeof value.cwd !== "string") {
    throw new Error("Invalid script target config: cwd must be a string");
  }

  if (value.env !== undefined && !isStringRecord(value.env)) {
    throw new Error("Invalid script target config: env must be a string record");
  }

  return {
    ...(value.description ? { description: value.description } : {}),
    commands,
    ...(value.cwd ? { cwd: value.cwd } : {}),
    ...(value.env ? { env: value.env } : {}),
  };
}

function parseScriptCommandConfig(name: string, value: unknown): ScriptCommandConfig {
  if (reservedScriptCommands.has(name)) {
    throw new Error(`Invalid script target config: command name is reserved: ${name}`);
  }
  if (!isRecord(value)) throw new Error(`Invalid script command config: ${name} must be an object`);
  if (typeof value.script !== "string" && typeof value.file !== "string") {
    throw new Error(`Invalid script command config: ${name} requires script or file`);
  }
  if (typeof value.script === "string" && typeof value.file === "string") {
    throw new Error(`Invalid script command config: ${name} cannot set both script and file`);
  }
  if (value.description !== undefined && typeof value.description !== "string") {
    throw new Error(`Invalid script command config: ${name}.description must be a string`);
  }
  if (value.args !== undefined && !isStringArray(value.args)) {
    throw new Error(`Invalid script command config: ${name}.args must be a string array`);
  }
  if (value.env !== undefined && !isStringRecord(value.env)) {
    throw new Error(`Invalid script command config: ${name}.env must be a string record`);
  }

  return {
    ...(typeof value.script === "string" ? { script: value.script } : {}),
    ...(typeof value.file === "string" ? { file: value.file } : {}),
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    ...(value.args ? { args: value.args } : {}),
    ...(value.env ? { env: value.env } : {}),
  };
}

async function executeScriptTarget(
  config: ScriptAdapterConfig,
  ctx: GatewayInvokeContext,
  target: string,
): Promise<GatewayResult> {
  if (isScriptCommandsConfig(config)) return executeScriptCommandTarget(config, ctx, target);

  const argv = [config.command, ...(config.args ?? []), ...ctx.argv];

  if (ctx.dryRun) {
    return {
      ok: true,
      value: {
        command: argv,
        ...(config.cwd ? { cwd: config.cwd } : {}),
        ...(config.env ? { env: config.env } : {}),
      },
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
      ...(config.env ? { env: { ...Bun.env, ...config.env } } : {}),
    });
  } catch (error) {
    return {
      ok: false,
      error: { message: errorMessage(error) },
      exitCode: 127,
    };
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode === 0) {
    return { ok: true, value: stripFinalNewline(stdout), exitCode };
  }

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

function isScriptCommandsConfig(config: ScriptAdapterConfig): config is ScriptCommandsConfig {
  return "commands" in config;
}

function stripFinalNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const reservedScriptCommands = new Set(["tools", "describe", "types", "refresh", "login", "logout"]);
