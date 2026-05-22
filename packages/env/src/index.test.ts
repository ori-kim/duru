import { describe, expect, test } from "bun:test";
import { createCli } from "@clip/core";
import { env } from "@clip/env";
import { input } from "@clip/input-validation";
import * as z from "zod";

describe("@clip/env", () => {
  test("fills declared options from auto environment fallbacks by default", async () => {
    const cli = createCli({ name: "clip" }).use(env({ source: { NAME: "example" } }));

    cli
      .command(
        "hello",
        input({
          options: {
            name: z.string().min(1),
          },
        }),
      )
      .action((ctx) => ({ name: ctx.options.name, rawName: ctx.raw.options.name }));

    const result = await cli.run(["hello"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "example", rawName: "example" });
  });

  test("keeps explicit cli options ahead of environment fallbacks", async () => {
    const cli = createCli({ name: "clip" }).use(env({ source: { NAME: "from-env" } }));

    cli
      .command(
        "hello",
        input({
          options: {
            name: z.string().min(1),
          },
        }),
      )
      .action((ctx) => ({ name: ctx.options.name, rawName: ctx.raw.options.name }));

    const result = await cli.run(["hello", "--name", "from-cli"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "from-cli", rawName: "from-cli" });
  });

  test("derives upper snake case environment names from camel case options", async () => {
    const cli = createCli({ name: "clip" }).use(env({ source: { TIMEOUT_MS: "2500" } }));

    cli
      .command(
        "call",
        input({
          options: {
            timeoutMs: z.coerce.number().int().positive(),
          },
        }),
      )
      .action((ctx) => ({ timeoutMs: ctx.options.timeoutMs, rawTimeoutMs: ctx.raw.options.timeoutMs }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ timeoutMs: 2500, rawTimeoutMs: "2500" });
  });

  test("can disable automatic environment fallbacks", async () => {
    const cli = createCli({ name: "clip" }).use(env({ auto: false, source: { NAME: "example" } }));

    cli
      .command(
        "hello",
        input({
          options: {
            name: z.string().default("schema-default"),
          },
        }),
      )
      .action((ctx) => ({ name: ctx.options.name, rawName: ctx.raw.options.name }));

    const result = await cli.run(["hello"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ name: "schema-default", rawName: undefined });
  });

  test("supports explicit env names and zod coercion", async () => {
    const cli = createCli({ name: "clip" }).use(
      env({
        source: { TEST_SERVICE_TIMEOUT_MS: "2500" },
        vars: {
          timeoutMs: ["TEST_SERVICE_TIMEOUT_MS", z.coerce.number().int().positive()],
        },
      }),
    );

    cli
      .command("call")
      .option("--timeout-ms <ms>")
      .action((ctx) => ({ timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ timeoutMs: 2500 });
  });

  test("does not duck type safeParse-only parser objects", async () => {
    const cli = createCli({ name: "clip" }).use(
      env({
        source: { TIMEOUT_MS: "2500" },
        vars: {
          timeoutMs: ["TIMEOUT_MS", { safeParse: () => ({ success: true, data: 2500 }) } as never],
        },
      }),
    );

    cli
      .command(
        "call",
        input({
          options: z.object({
            timeoutMs: z.coerce.number().int().positive().default(30000),
          }),
        }),
      )
      .action((ctx) => ({ timeoutMs: ctx.options.timeoutMs }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ timeoutMs: 30000 });
  });

  test("reports parser validation failures before actions run", async () => {
    const cli = createCli({ name: "clip" }).use(
      env({
        source: { TEST_SERVICE_TIMEOUT_MS: "0" },
        vars: {
          timeoutMs: ["TEST_SERVICE_TIMEOUT_MS", z.coerce.number().int().positive()],
        },
      }),
    );

    cli
      .command("call")
      .option("--timeout-ms <ms>")
      .action(() => ({ unreachable: true }));

    const result = await cli.run(["call"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(2);
    expect(result.result).toMatchObject({
      source: "options",
      issues: [{ path: ["timeoutMs"], code: "invalid_env" }],
    });
  });

  test("keeps matched raw params available when parser validation fails", async () => {
    const cli = createCli({ name: "clip" }).use(
      env({
        source: { TEST_SERVICE_TIMEOUT_MS: "0" },
        vars: {
          timeoutMs: ["TEST_SERVICE_TIMEOUT_MS", z.coerce.number().int().positive()],
        },
      }),
    );

    cli
      .command("call <operation>")
      .option("--timeout-ms <ms>")
      .catch((ctx) => ctx.exit(2, { operation: ctx.raw.params.operation, timeoutMs: ctx.raw.options.timeoutMs }))
      .action(() => ({ unreachable: true }));

    const result = await cli.run(["call", "list"], { render: false });

    expect(result.ok).toBe(false);
    expect(result.result).toEqual({ operation: "list", timeoutMs: undefined });
  });
});
