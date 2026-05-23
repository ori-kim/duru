import type { AddInput, GatewayAdapter, GatewayInvokeContext, GatewayResult } from "../types";

export type GrpcAdapterConfig = {
  address: string;
  command?: string;
  headers?: Record<string, string>;
  plaintext?: boolean;
};

export function grpcAdapter(): GatewayAdapter<GrpcAdapterConfig> {
  return {
    type: "grpc",
    schema: { parse: parseGrpcConfig },
    async add(input) {
      return grpcConfigFromAddInput(input);
    },
    createTarget({ manifest, config }) {
      return {
        name: manifest.name,
        type: manifest.type,
        config,
        async invoke(ctx) {
          return executeGrpcTarget(config, ctx);
        },
        async catalog() {
          return [];
        },
        listRow() {
          return { name: manifest.name, type: "grpc", summary: config.address };
        },
        async check() {
          return { diagnostics: [] };
        },
      };
    },
  };
}

function grpcConfigFromAddInput(input: AddInput): GrpcAdapterConfig {
  const address = input.argv[0];
  if (!address) throw new Error("gRPC target requires an address argument");
  return { address };
}

function parseGrpcConfig(value: unknown): GrpcAdapterConfig {
  if (!isRecord(value) || typeof value.address !== "string" || value.address.length === 0) {
    throw new Error("Invalid grpc target config: address is required");
  }

  if (value.command !== undefined && typeof value.command !== "string") {
    throw new Error("Invalid grpc target config: command must be a string");
  }

  if (value.headers !== undefined && !isStringRecord(value.headers)) {
    throw new Error("Invalid grpc target config: headers must be a string record");
  }

  if (value.plaintext !== undefined && typeof value.plaintext !== "boolean") {
    throw new Error("Invalid grpc target config: plaintext must be a boolean");
  }

  return {
    address: value.address,
    ...(value.command ? { command: value.command } : {}),
    ...(value.headers ? { headers: value.headers } : {}),
    ...(typeof value.plaintext === "boolean" ? { plaintext: value.plaintext } : {}),
  };
}

async function executeGrpcTarget(config: GrpcAdapterConfig, ctx: GatewayInvokeContext): Promise<GatewayResult> {
  if (ctx.argv.length === 0) {
    return { ok: false, error: { message: "gRPC method is required" }, exitCode: 2 };
  }

  const argv = buildCommand(config, ctx.argv);

  if (ctx.dryRun) {
    return { ok: true, value: { command: argv }, exitCode: 0 };
  }

  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;

  try {
    child = Bun.spawn(argv, {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      signal: ctx.signal,
    });
  } catch (error) {
    return { ok: false, error: { message: errorMessage(error) }, exitCode: 127 };
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
      message: stripFinalNewline(stderr || stdout) || `gRPC command failed with exit code ${exitCode}`,
      stdout: stripFinalNewline(stdout),
      stderr: stripFinalNewline(stderr),
    },
    exitCode,
  };
}

function buildCommand(config: GrpcAdapterConfig, methodArgs: readonly string[]): string[] {
  return [
    config.command ?? "grpcurl",
    ...(config.plaintext ? ["-plaintext"] : []),
    ...headerArgs(config.headers ?? {}),
    config.address,
    ...methodArgs,
  ];
}

function headerArgs(headers: Record<string, string>): string[] {
  return Object.entries(headers).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
}

function stripFinalNewline(value: string): string {
  return value.replace(/\r?\n$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
