import type { AddInput, GatewayAdapter, GatewayInvokeContext, GatewayResult } from "../types";

export type ScriptAdapterConfig = {
  command: string;
  args?: readonly string[];
  cwd?: string;
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
          return executeScriptTarget(config, ctx);
        },
        listRow() {
          return { name: manifest.name, type: "script", summary: config.command };
        },
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function scriptConfigFromAddInput(input: AddInput): ScriptAdapterConfig {
  const command = input.argv[0] ?? input.name;
  return {
    command,
    args: input.argv.slice(1),
  };
}

function parseScriptConfig(value: unknown): ScriptAdapterConfig {
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

async function executeScriptTarget(config: ScriptAdapterConfig, ctx: GatewayInvokeContext): Promise<GatewayResult> {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
