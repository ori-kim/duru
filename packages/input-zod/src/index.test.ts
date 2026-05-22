import { describe, expect, test } from "bun:test";
import { adaptResult, createCli, formatHelp, help, isHelpDocument, isValidationError, renderer } from "@clip/core";
import type { Renderer } from "@clip/core";
import { z, zodInput } from "@clip/input-zod";

describe("@clip/input-zod", () => {
  test("validates and transforms command params and options", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        z({
          params: {
            operation: z.string().min(1),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive().default(30000),
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation, timeoutMs: ctx.options.timeoutMs }));

    const explicit = await cli.run(["call", "list", "--timeout-ms", "2500"], { render: false });
    const defaulted = await cli.run(["call", "list"], { render: false });

    expect(explicit.ok).toBe(true);
    expect(explicit.result).toEqual({ operation: "list", timeoutMs: 2500 });
    expect(defaulted.result).toEqual({ operation: "list", timeoutMs: 30000 });
  });

  test("accepts z.object groups and boolean options", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        z({
          params: z.object({
            operation: z.string().min(1),
          }),
          options: z.object({
            dryRun: z.boolean().default(false),
          }),
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation, dryRun: ctx.options.dryRun }));

    const enabled = await cli.run(["call", "list", "--dry-run"], { render: false });
    const defaulted = await cli.run(["call", "list"], { render: false });

    expect(enabled.result).toEqual({ operation: "list", dryRun: true });
    expect(defaulted.result).toEqual({ operation: "list", dryRun: false });
  });

  test("supports explicit zodInput alias", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        zodInput({
          params: {
            operation: z.string().min(1),
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation }));

    const result = await cli.run(["call", "list"], { render: false });

    expect(result.result).toEqual({ operation: "list" });
  });

  test("treats boolean transforms as flag options", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        z({
          options: {
            verbose: z.boolean().transform((value) => (value ? "enabled" : "disabled")),
          },
        }),
      )
      .action((ctx) => ({ verbose: ctx.options.verbose }));

    const result = await cli.run(["call", "--verbose"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ verbose: "enabled" });
  });

  test("does not execute schemas while building command metadata", () => {
    let calls = 0;

    zodInput({
      params: {
        operation: z.preprocess((value) => {
          calls += 1;
          return value;
        }, z.string()),
        fallback: z.string().default(() => {
          calls += 1;
          return "default";
        }),
      },
    });

    expect(calls).toBe(0);
  });

  test("treats preprocess-wrapped default params as optional without metadata side effects", async () => {
    let calls = 0;
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        zodInput({
          params: {
            operation: z.preprocess((value) => {
              calls += 1;
              return value ?? "list";
            }, z.string().default("list")),
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation }));

    expect(calls).toBe(0);

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ operation: "list" });
    expect(calls).toBe(1);
  });

  test("keeps required pipe params required when only the output accepts undefined", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        zodInput({
          params: {
            operation: z.string().pipe(z.string().optional() as never),
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  test("rejects required params after optional params", () => {
    expect(() => {
      zodInput({
        params: {
          mode: z.string().default("auto"),
          operation: z.string().min(1),
        },
      });
    }).toThrow("Required params cannot follow optional params: operation");
  });

  test("rejects duplicate generated option aliases", () => {
    expect(() => {
      zodInput({
        options: {
          fooBar: z.string(),
          "foo-bar": z.string(),
        },
      });
    }).toThrow("Duplicate command option alias: --foo-bar");
  });

  test("rejects param keys that cannot become command params", () => {
    for (const key of ["", "project id", "<name>", "[name]"]) {
      expect(() => {
        zodInput({
          params: {
            [key]: z.string(),
          },
        });
      }).toThrow(
        `Invalid Zod param key: ${JSON.stringify(key)}. Keys must be non-empty and cannot contain whitespace, <, >, [, or ].`,
      );
    }
  });

  test("rejects option keys that cannot become command options", () => {
    for (const key of ["", "dry run", "<token>", "[token]"]) {
      expect(() => {
        zodInput({
          options: {
            [key]: z.string(),
          },
        });
      }).toThrow(
        `Invalid Zod option key: ${JSON.stringify(key)}. Keys must be non-empty and cannot contain whitespace, <, >, [, or ].`,
      );
    }
  });

  test("contributes command params and options to help metadata", async () => {
    const cli = createCli({ name: "clip" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());

    cli
      .command(
        "call",
        z({
          params: {
            operation: z.string().min(1).describe("Operation name"),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive().default(30000).describe("Timeout in milliseconds"),
          },
        }),
      )
      .action(() => undefined);

    const result = await cli.run(["call", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: clip call <operation>");
    expect(result.rendered?.stdout).toContain("--timeout-ms");
    expect(result.rendered?.stdout).toContain("Timeout in milliseconds");
  });

  test("maps validation failures to stable core validation issues", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        z({
          params: {
            operation: z.string().min(3),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive(),
          },
        }),
      )
      .action(() => {
        calls.push("action");
        return { reached: true };
      });

    const result = await cli.run(["call", "ls", "--timeout-ms", "0"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toMatchObject({
      kind: "clip.validation_error",
      source: "input",
      issues: [
        { path: ["operation"], code: "too_small" },
        { path: ["timeoutMs"], code: "too_small" },
      ],
    });
    expect(calls).toEqual([]);
  });

  test("preserves raw matched context when validation fails", async () => {
    const cli = createCli({ name: "clip" });
    cli.catch((ctx) =>
      ctx.exit(2, {
        isValidationError: isValidationError(ctx.error),
        rawParams: ctx.raw.params,
        rawOptions: ctx.raw.options,
      }),
    );

    cli
      .command(
        "call",
        z({
          params: {
            operation: z.string().min(3),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive(),
          },
        }),
      )
      .action(() => ({ reached: true }));

    const result = await cli.run(["call", "ls", "--timeout-ms", "0"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toEqual({
      isValidationError: true,
      rawParams: { operation: "ls" },
      rawOptions: { timeoutMs: "0" },
    });
  });

  test("infers transformed action param and option types", () => {
    createCli()
      .command(
        "call",
        z({
          params: {
            operation: z.string().min(1),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive().default(30000),
          },
        }),
      )
      .action((ctx) => {
        const typedOperation: string = ctx.params.operation;
        const typedTimeout: number = ctx.options.timeoutMs;
        return { typedOperation, typedTimeout };
      });
  });
});

function testRenderer(id = "test"): Renderer {
  return {
    id,
    render(input) {
      return {
        stdout: `${JSON.stringify(input.value)}\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  };
}

function helpTextAdapter() {
  return adaptResult({
    match: isHelpDocument,
    adapt: formatHelp,
  });
}
