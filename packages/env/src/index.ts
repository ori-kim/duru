import { createPlugin, validationError } from "@duru/cli-kit";
import type { CliPlugin, OptionDefinition, ValidationIssue } from "@duru/cli-kit";

export type EnvSource = Readonly<Record<string, string | undefined>>;

type StandardSchema<TOutput = unknown> = {
  readonly "~standard": {
    readonly validate: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>;
  };
};

type StandardResult<TOutput> =
  | {
      readonly value: TOutput;
      readonly issues?: undefined;
    }
  | {
      readonly issues: readonly StandardIssue[];
    };

type StandardIssue = {
  readonly message: string;
  readonly path?: readonly (PropertyKey | { key: PropertyKey })[];
};

export type EnvParser<TValue = unknown> = StandardSchema<TValue> | ((value: string) => TValue | Promise<TValue>);

export type EnvVarSpec<TValue = unknown> = string | readonly [envName: string, parser: EnvParser<TValue>];
export type EnvVarMap = Record<string, EnvVarSpec>;

export type EnvOptions<TVars extends EnvVarMap = EnvVarMap> = {
  auto?: boolean;
  vars?: TVars;
  source?: EnvSource;
};

type EnvFallback =
  | {
      found: true;
      value: unknown;
    }
  | {
      found: false;
    };

export function env<TVars extends EnvVarMap = Record<never, never>>(options: EnvOptions<TVars> = {}): CliPlugin {
  const auto = options.auto ?? true;
  const vars = options.vars ?? {};
  const source = options.source ?? defaultEnvSource();

  return createPlugin((api) => {
    api.optionFallback(async ({ option }) => {
      const explicit = await explicitFallback(option.name, vars, source);
      if (explicit.found) return explicit.value;
      if (!auto) return undefined;

      return source[envNameForOption(option)];
    });
  });
}

async function explicitFallback(optionName: string, vars: EnvVarMap, source: EnvSource): Promise<EnvFallback> {
  if (!Object.prototype.hasOwnProperty.call(vars, optionName)) return { found: false };

  const spec = vars[optionName];
  if (spec === undefined) return { found: false };
  const envName = typeof spec === "string" ? spec : spec[0];
  const raw = source[envName];
  if (raw === undefined) return { found: false };
  if (typeof spec === "string") return { found: true, value: raw };

  return { found: true, value: await parseEnvValue(optionName, raw, spec[1]) };
}

async function parseEnvValue(optionName: string, raw: string, parser: EnvParser): Promise<unknown> {
  if (isStandardSchema(parser)) {
    const result = await parser["~standard"].validate(raw);
    if (!("issues" in result) || !result.issues) return result.value;
    throw validationError("options", parserIssues(optionName, result.issues));
  }

  if (typeof parser === "function") {
    try {
      return await parser(raw);
    } catch (error) {
      throw validationError("options", [
        {
          path: [optionName],
          code: "invalid_env",
          message: error instanceof Error ? error.message : "Invalid environment variable",
        },
      ]);
    }
  }

  return undefined;
}

function parserIssues(optionName: string, issues: readonly StandardIssue[]): ValidationIssue[] {
  if (issues.length === 0) {
    return [{ path: [optionName], code: "invalid_env", message: "Invalid environment variable" }];
  }

  return issues.map((issue) => ({
    path: [optionName, ...issuePath(issue.path)],
    code: "invalid_env",
    message: issue.message,
  }));
}

function issuePath(path: StandardIssue["path"]): string[] {
  return (path ?? []).map((segment) => String(typeof segment === "object" && segment !== null ? segment.key : segment));
}

function isStandardSchema(value: EnvParser): value is StandardSchema {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { "~standard"?: { validate?: unknown } })["~standard"]?.validate === "function"
  );
}

function envNameForOption(option: OptionDefinition): string {
  return option.name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function defaultEnvSource(): EnvSource {
  return typeof process === "undefined" ? {} : process.env;
}
