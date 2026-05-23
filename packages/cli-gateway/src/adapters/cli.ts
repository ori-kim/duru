import type { AddInput, ExecuteContext, GatewayAdapter, GatewayResult } from "../types";

export type CliAdapterConfig = {
  command: string;
  args?: readonly string[];
};

export function cliAdapter(): GatewayAdapter<CliAdapterConfig> {
  return {
    type: "cli",
    schema: { parse: parseCliConfig },
    async add(input) {
      return cliConfigFromAddInput(input);
    },
    createTarget({ manifest, config }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return executeCliTarget(config, ctx);
        },
        listRow() {
          return { name: manifest.name, type: "cli", summary: config.command };
        },
      };
    },
  };
}

function cliConfigFromAddInput(input: AddInput): CliAdapterConfig {
  const command = input.argv[0] ?? input.name;
  return {
    command,
    args: input.argv.slice(1),
  };
}

function parseCliConfig(value: unknown): CliAdapterConfig {
  if (!isRecord(value) || typeof value.command !== "string" || value.command.length === 0) {
    throw new Error("Invalid cli target config: command is required");
  }

  if (value.args !== undefined && !isStringArray(value.args)) {
    throw new Error("Invalid cli target config: args must be a string array");
  }

  return {
    command: value.command,
    args: value.args,
  };
}

async function executeCliTarget(config: CliAdapterConfig, ctx: ExecuteContext): Promise<GatewayResult> {
  const argv = [config.command, ...(config.args ?? []), ...ctx.argv];
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;

  try {
    child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal,
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
      message: stripFinalNewline(stderr || stdout) || `Command failed with exit code ${exitCode}`,
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
  return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
