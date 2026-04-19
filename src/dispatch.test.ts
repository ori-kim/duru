import { describe, expect, spyOn, test } from "bun:test";
import type { Config, ResolvedTarget } from "./config.ts";
import { dispatch } from "./dispatch.ts";
import { Registry } from "./extension.ts";
import type { ExecutorContext, TargetResult } from "./extension.ts";

// --- helpers ---

const emptyCfg: Config = { cli: {}, mcp: {}, api: {}, grpc: {}, graphql: {}, script: {}, _ext: {} };

async function makeRegistry(
  fn: (target: unknown, ctx: ExecutorContext) => Promise<TargetResult>,
  overrides: Record<string, (target: unknown, ctx: ExecutorContext) => Promise<TargetResult>> = {},
): Promise<Registry> {
  const reg = new Registry();
  for (const type of ["cli", "mcp", "api", "grpc", "graphql", "script"]) {
    const executor = overrides[type] ?? fn;
    reg.register({
      name: `mock:${type}`,
      init(api) {
        api.registerTargetType({ type, schema: { safeParse: (x) => ({ success: true, data: x }) }, executor });
      },
    });
  }
  await reg.initAll();
  return reg;
}

function baseInput(overrides: Partial<Parameters<typeof dispatch>[1]> = {}) {
  return {
    targetName: "test",
    resolvedTarget: {
      type: "cli" as const,
      target: { command: "echo", commands: {} } as never,
    } as ResolvedTarget,
    subcommand: "run",
    args: [],
    headers: {},
    dryRun: false,
    jsonMode: false,
    passthrough: false,
    env: {},
    ...overrides,
  };
}

const noop = async (): Promise<TargetResult> => ({ exitCode: 0, stdout: "", stderr: "" });

// --- alias 확장 ---

describe("dispatch / alias 확장", () => {
  test("alias가 있으면 subcommand가 확장된 값으로 executor에 전달", async () => {
    let capturedCtx: ExecutorContext | undefined;
    const reg = await makeRegistry(async (_, ctx) => {
      capturedCtx = ctx;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const target = {
      command: "echo",
      aliases: { st: { subcommand: "status" } },
    } as never;

    await dispatch(
      emptyCfg,
      baseInput({
        resolvedTarget: { type: "cli", target } as ResolvedTarget,
        subcommand: "st",
      }),
      reg,
    );

    expect(capturedCtx?.subcommand).toBe("status");
  });

  test("alias가 없으면 원래 subcommand 그대로", async () => {
    let capturedCtx: ExecutorContext | undefined;
    const reg = await makeRegistry(async (_, ctx) => {
      capturedCtx = ctx;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await dispatch(emptyCfg, baseInput({ subcommand: "status" }), reg);
    expect(capturedCtx?.subcommand).toBe("status");
  });
});

// --- ACL 거부 ---

describe("dispatch / ACL 거부", () => {
  test("deny 목록에 있으면 throw하고 executor 미호출", async () => {
    let called = false;
    const reg = await makeRegistry(async () => {
      called = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation((): never => {
      throw new Error("acl-denied");
    });
    try {
      await dispatch(
        emptyCfg,
        baseInput({
          resolvedTarget: {
            type: "cli",
            target: { command: "echo", deny: ["delete"] } as never,
          } as ResolvedTarget,
          subcommand: "delete",
        }),
        reg,
      ).catch(() => {});
      expect(called).toBe(false);
    } finally {
      exitSpy.mockRestore();
      errSpy.mockRestore();
    }
  });
});

// --- ACL bypass (tools) ---

describe("dispatch / ACL bypass", () => {
  test("non-cli의 tools subcommand는 ACL 없이 executor 호출", async () => {
    let capturedCtx: ExecutorContext | undefined;
    const reg = await makeRegistry(async (_, ctx) => {
      capturedCtx = ctx;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    const target = { url: "http://example.com", deny: ["tools"] } as never;

    await dispatch(
      emptyCfg,
      baseInput({
        resolvedTarget: { type: "mcp", target } as ResolvedTarget,
        subcommand: "tools",
      }),
      reg,
    );

    expect(capturedCtx?.subcommand).toBe("tools");
  });
});

// --- headers/dryRun 전달 ---

describe("dispatch / context 전달", () => {
  test("headers와 dryRun이 ctx에 그대로 전달", async () => {
    let capturedCtx: ExecutorContext | undefined;
    const reg = await makeRegistry(async (_, ctx) => {
      capturedCtx = ctx;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    await dispatch(
      emptyCfg,
      baseInput({
        headers: { Authorization: "Bearer tok" },
        dryRun: true,
      }),
      reg,
    );

    expect(capturedCtx?.headers).toEqual({ Authorization: "Bearer tok" });
    expect(capturedCtx?.dryRun).toBe(true);
  });
});

// --- mcp executor 호출 ---

describe("dispatch / mcp executor 호출", () => {
  test("mcp type이면 mcp executor가 호출되고 target이 전달됨", async () => {
    let capturedTarget: unknown;
    let capturedCtx: ExecutorContext | undefined;

    const reg = await makeRegistry(noop, {
      mcp: async (target, ctx) => {
        capturedTarget = target;
        capturedCtx = ctx;
        return { exitCode: 0, stdout: "mcp-ok", stderr: "" };
      },
    });

    const mcpTarget = { transport: "http", url: "http://example.com" } as never;

    const result = await dispatch(
      emptyCfg,
      baseInput({
        resolvedTarget: { type: "mcp", target: mcpTarget } as ResolvedTarget,
        subcommand: "list_tools",
      }),
      reg,
    );

    expect(result.stdout).toBe("mcp-ok");
    expect(capturedCtx?.subcommand).toBe("list_tools");
    expect(capturedTarget).toBe(mcpTarget);
  });
});

// --- Registry 훅 통합 ---

describe("dispatch / registry 훅 통합", () => {
  test("beforeExecute 훅이 headers를 주입하면 executor에 전달", async () => {
    let capturedCtx: ExecutorContext | undefined;
    const reg = await makeRegistry(async (_, ctx) => {
      capturedCtx = ctx;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    reg.register({
      name: "auth-hook",
      init(api) {
        api.registerHook("beforeExecute", async () => ({
          headers: { Authorization: "Bearer injected" },
        }));
      },
    });
    await reg.initAll();

    await dispatch(emptyCfg, baseInput({ headers: {} }), reg);
    expect(capturedCtx?.headers?.["Authorization"]).toBe("Bearer injected");
  });

  test("beforeExecute shortCircuit이 executor를 우회", async () => {
    let executorCalled = false;
    const reg = await makeRegistry(async () => {
      executorCalled = true;
      return { exitCode: 0, stdout: "", stderr: "" };
    });

    reg.register({
      name: "short",
      init(api) {
        api.registerHook("beforeExecute", async () => ({
          shortCircuit: { exitCode: 99, stdout: "bypassed", stderr: "" },
        }));
      },
    });
    await reg.initAll();

    const result = await dispatch(emptyCfg, baseInput(), reg);
    expect(result.exitCode).toBe(99);
    expect(result.stdout).toBe("bypassed");
    expect(executorCalled).toBe(false);
  });

  test("afterExecute 훅이 result를 부분 머지", async () => {
    const reg = await makeRegistry(async () => ({
      exitCode: 0,
      stdout: "original",
      stderr: "",
    }));

    reg.register({
      name: "after",
      init(api) {
        api.registerHook("afterExecute", async () => ({
          result: { stdout: "modified" },
        }));
      },
    });
    await reg.initAll();

    const result = await dispatch(emptyCfg, baseInput(), reg);
    expect(result.stdout).toBe("modified");
    expect(result.exitCode).toBe(0);
  });
});
