import { describe, expect, test } from "bun:test";
import { createCli, formatHelp, help, isHelpDocument, isValidationError, meta, renderer } from "@clip/core";
import { adaptResult } from "@clip/core";
import type { Renderer } from "@clip/core";
import { input } from "@clip/input-validation";
import { z } from "zod";

describe("@clip/input-validation", () => {
  test("supports zod schemas without owning the zod dependency", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        input({
          params: z.object({
            operation: z.coerce.number().min(1),
          }),
          options: z.object({
            timeoutMs: z.coerce.number().int().positive().default(30000),
            dryRun: z.boolean().default(false),
          }),
        }),
        meta({
          description: "Run a typed command input demo",
          examples: ["clip call 7 --timeout-ms 1500 --dry-run"],
          group: "Examples",
        }),
      )
      .action((ctx) => ({
        operation: ctx.params.operation,
        timeoutMs: ctx.options.timeoutMs,
        dryRun: ctx.options.dryRun,
      }))
      .text((result) => `${result.operation} timeout=${result.timeoutMs} dryRun=${result.dryRun}`)
      .json((result) => result);

    const explicit = await cli.run(["call", "7", "--timeout-ms", "1500", "--dry-run"], { render: false });
    const defaulted = await cli.run(["call", "7"], { render: false });

    expect(explicit.ok).toBe(true);
    expect(explicit.result).toEqual({ operation: 7, timeoutMs: 1500, dryRun: true });
    expect(defaulted.result).toEqual({ operation: 7, timeoutMs: 30000, dryRun: false });
  });

  test("supports explicit field maps for standard schema libraries without object introspection", async () => {
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        input({
          params: {
            operation: z.coerce.number().min(1),
          },
          options: {
            timeoutMs: z.coerce.number().int().positive().default(30000),
          },
        }),
      )
      .action((ctx) => ({ operation: ctx.params.operation, timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call", "7"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ operation: 7, timeoutMs: 30000 });
  });

  test("maps standard schema failures to stable core validation issues", async () => {
    const calls: string[] = [];
    const cli = createCli({ name: "clip" });

    cli
      .command(
        "call",
        input({
          params: z.object({
            operation: z.string().min(3),
          }),
          options: z.object({
            timeoutMs: z.coerce.number().int().positive(),
          }),
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
      issues: [{ path: ["operation"] }, { path: ["timeoutMs"] }],
    });
    expect(calls).toEqual([]);
  });

  test("contributes generated params and options to help metadata", async () => {
    const cli = createCli({ name: "clip" }).use(helpTextAdapter()).use(renderer(testRenderer())).use(help());

    cli
      .command(
        "call",
        input({
          params: z.object({
            operation: z.string().min(1).describe("Operation name"),
          }),
          options: z.object({
            timeoutMs: z.coerce.number().int().positive().default(30000).describe("Timeout in milliseconds"),
          }),
        }),
      )
      .action(() => undefined);

    const result = await cli.run(["call", "--help"]);

    expect(result.rendered?.stdout).toContain("Usage: clip call <operation>");
    expect(result.rendered?.stdout).toContain("--timeout-ms");
    expect(result.rendered?.stdout).toContain("Timeout in milliseconds");
  });

  test("infers transformed action param and option types", () => {
    createCli()
      .command(
        "call",
        input({
          params: z.object({
            operation: z.coerce.number().min(1),
          }),
          options: z.object({
            timeoutMs: z.coerce.number().int().positive().default(30000),
          }),
        }),
      )
      .action((ctx) => {
        const typedOperation: number = ctx.params.operation;
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
