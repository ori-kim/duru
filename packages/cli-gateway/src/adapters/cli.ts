import type {
  AddInput,
  CompletionItem,
  ExecuteContext,
  GatewayAdapter,
  GatewayCompletionContext,
  GatewayResult,
} from "../types";

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
        async complete(ctx) {
          return completeCliTarget(config, ctx);
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

async function completeCliTarget(
  config: CliAdapterConfig,
  ctx: GatewayCompletionContext,
): Promise<readonly CompletionItem[]> {
  if (ctx.argv.length > 1) return [];

  const current = ctx.argv[0] ?? "";
  const helpText = await cliHelpText(config);
  return parseCliHelpCommands(helpText).filter((item) => item.value.startsWith(current));
}

async function cliHelpText(config: CliAdapterConfig): Promise<string> {
  const timeout = timeoutSignal(1000);
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;

  try {
    child = Bun.spawn([config.command, ...(config.args ?? []), "--help"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: timeout.signal,
    });
  } catch {
    timeout.dispose();
    return "";
  }

  try {
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    await child.exited.catch(() => undefined);
    return stdout || stderr;
  } catch {
    return "";
  } finally {
    timeout.dispose();
  }
}

function parseCliHelpCommands(text: string): readonly CompletionItem[] {
  const items: CompletionItem[] = [];
  let inCommandSection = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/commands/i.test(line) && line.toUpperCase() === line) {
      inCommandSection = true;
      continue;
    }
    if (!inCommandSection) continue;

    const parsed = parseHelpCommandLine(line);
    if (parsed) items.push(parsed);
  }

  return dedupeCompletionItems(items);
}

function parseHelpCommandLine(line: string): CompletionItem | undefined {
  const colon = /^(?:[A-Za-z0-9._-]+\s+)?([A-Za-z0-9][\w:-]*):\s+(.+)$/.exec(line);
  if (colon) return operationItem(colon[1] as string, colon[2] as string);

  const spaced = /^([A-Za-z0-9][\w:-]*)\s{2,}(.+)$/.exec(line);
  if (spaced) return operationItem(spaced[1] as string, spaced[2] as string);

  return undefined;
}

function operationItem(value: string, description: string): CompletionItem {
  return {
    value,
    description: description.trim(),
    kind: "operation",
    group: "gateway operations",
  };
}

function dedupeCompletionItems(items: readonly CompletionItem[]): readonly CompletionItem[] {
  const seen = new Set<string>();
  const next: CompletionItem[] = [];
  for (const item of items) {
    if (seen.has(item.value)) continue;
    seen.add(item.value);
    next.push(item);
  }
  return next;
}

function timeoutSignal(ms: number): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
    },
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
