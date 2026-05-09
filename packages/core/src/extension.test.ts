import { describe, expect, test } from "bun:test";
import { type ErrorCtx, type HookCtx, Registry } from "./extension.ts";

function makeCtx(overrides: Partial<HookCtx> = {}): HookCtx {
  return {
    phase: "target-start",
    targetName: "test",
    targetType: "cli",
    target: Object.freeze({}),
    subcommand: "run",
    args: Object.freeze([]) as readonly string[],
    headers: Object.freeze({}) as Record<string, string>,
    dryRun: false,
    jsonMode: false,
    passthrough: false,
    ...overrides,
  };
}

function makeErrorCtx(overrides: Partial<ErrorCtx> = {}): ErrorCtx {
  return {
    ...makeCtx(),
    phase: "target-error",
    error: new Error("test error"),
    ...overrides,
  };
}

// --- 등록 ---

describe("Registry / 등록", () => {
  test("extension init에서 hook 등록 → runHooks에서 호출됨", async () => {
    const reg = new Registry();
    let called = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => {
          called = true;
        });
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx());
    expect(called).toBe(true);
  });

  test("registerTargetType → getTargetType·listTypes 조회 가능", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerTargetType({
          type: "mytype",
          schema: {} as never,
          executor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
        });
      },
    });
    await reg.initAll();

    expect(reg.getTargetType("mytype")).toBeDefined();
    expect(reg.listTypes()).toContain("mytype");
  });
});

// --- 우선순위 ---

describe("Registry / 우선순위", () => {
  test("priority 낮은 훅이 먼저 실행", async () => {
    const reg = new Registry();
    const order: number[] = [];

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            order.push(2);
          },
          { priority: 200 },
        );
        api.registerHook(
          "target-start",
          async () => {
            order.push(1);
          },
          { priority: 50 },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx());
    expect(order).toEqual([1, 2]);
  });

  test("priority 기본값 100이 적용됨", async () => {
    const reg = new Registry();
    const order: number[] = [];

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => {
          order.push(100);
        });
        api.registerHook(
          "target-start",
          async () => {
            order.push(50);
          },
          { priority: 50 },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx());
    expect(order[0]).toBe(50);
  });
});

// --- match 필터링 ---

describe("Registry / match 필터링", () => {
  test("match.type 불일치 → 훅 미호출", async () => {
    const reg = new Registry();
    let called = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            called = true;
          },
          { match: { type: ["api"] } },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx({ targetType: "cli" }));
    expect(called).toBe(false);

    await reg.runHooks("target-start", makeCtx({ targetType: "api" }));
    expect(called).toBe(true);
  });

  test("match.target(string) 불일치 → 훅 미호출", async () => {
    const reg = new Registry();
    let called = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            called = true;
          },
          { match: { target: ["linear"] } },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx({ targetName: "notion" }));
    expect(called).toBe(false);

    await reg.runHooks("target-start", makeCtx({ targetName: "linear" }));
    expect(called).toBe(true);
  });

  test("match.target(RegExp) 패턴 매칭", async () => {
    const reg = new Registry();
    let called = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            called = true;
          },
          { match: { target: [/^lin/] } },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx({ targetName: "notion" }));
    expect(called).toBe(false);

    await reg.runHooks("target-start", makeCtx({ targetName: "linear" }));
    expect(called).toBe(true);
  });

  test("match.subcommand 불일치 → 훅 미호출", async () => {
    const reg = new Registry();
    let called = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            called = true;
          },
          { match: { subcommand: ["tools"] } },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx({ subcommand: "run" }));
    expect(called).toBe(false);

    await reg.runHooks("target-start", makeCtx({ subcommand: "tools" }));
    expect(called).toBe(true);
  });
});

// --- short-circuit ---

describe("Registry / short-circuit", () => {
  test("target-start에서 shortCircuit 반환 → 즉시 반환, 이후 훅 미호출", async () => {
    const reg = new Registry();
    let secondCalled = false;
    const shortResult = { exitCode: 42, stdout: "short", stderr: "" };

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => ({ shortCircuit: shortResult }), { priority: 10 });
        api.registerHook(
          "target-start",
          async () => {
            secondCalled = true;
          },
          { priority: 20 },
        );
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("target-start", makeCtx());
    expect(ret).toEqual({ shortCircuit: shortResult });
    expect(secondCalled).toBe(false);
  });

  test("cli-end에서 shortCircuit 반환 → 무시됨, null 반환", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("cli-end", async () => ({ shortCircuit: { exitCode: 0, stdout: "", stderr: "" } }));
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("cli-end", {
      phase: "cli-end",
      argv: [],
      startedAt: "2026-05-08T00:00:00.000Z",
      exitCode: 0,
    });
    expect(ret).toBeNull();
  });

  test("target-end에서 shortCircuit 반환 → 무시됨", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-end", async () => ({ shortCircuit: { exitCode: 0, stdout: "", stderr: "" } }));
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("target-end", makeCtx({ phase: "target-end" }));
    expect(ret).toBeNull();
  });
});

// --- target-end 역순 ---

describe("Registry / target-end 역순", () => {
  test("target-end는 priority 내림차순 실행 (높은 게 먼저)", async () => {
    const reg = new Registry();
    const order: number[] = [];

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-end",
          async () => {
            order.push(1);
          },
          { priority: 10 },
        );
        api.registerHook(
          "target-end",
          async () => {
            order.push(2);
          },
          { priority: 20 },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-end", makeCtx({ phase: "target-end" }));
    expect(order).toEqual([2, 1]);
  });

  test("target-start는 priority 오름차순 실행 (낮은 게 먼저)", async () => {
    const reg = new Registry();
    const order: number[] = [];

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook(
          "target-start",
          async () => {
            order.push(1);
          },
          { priority: 10 },
        );
        api.registerHook(
          "target-start",
          async () => {
            order.push(2);
          },
          { priority: 20 },
        );
      },
    });
    await reg.initAll();

    await reg.runHooks("target-start", makeCtx());
    expect(order).toEqual([1, 2]);
  });
});

// --- 타임아웃 ---

describe("Registry / 타임아웃", () => {
  test("CLIP_EXT_TIMEOUT_MS 초과 시 reject", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => {
          await new Promise((r) => setTimeout(r, 300));
        });
      },
    });
    await reg.initAll();

    const prev = process.env.CLIP_EXT_TIMEOUT_MS;
    process.env.CLIP_EXT_TIMEOUT_MS = "50";
    try {
      await expect(reg.runHooks("target-start", makeCtx())).rejects.toThrow("timed out");
    } finally {
      if (prev === undefined) process.env.CLIP_EXT_TIMEOUT_MS = undefined;
      else process.env.CLIP_EXT_TIMEOUT_MS = prev;
    }
  });
});

// --- onError ---

describe("Registry / onError", () => {
  test("runErrorHandlers 호출 → result 반환 시 전달됨", async () => {
    const reg = new Registry();
    let handlerCalled = false;

    reg.register({
      name: "ext",
      init(api) {
        api.registerErrorHandler(async (ctx) => {
          handlerCalled = true;
          expect(ctx.error).toBeInstanceOf(Error);
          return { result: { exitCode: 99, stdout: "caught", stderr: "" } };
        });
      },
    });
    await reg.initAll();

    const ret = await reg.runErrorHandlers(makeErrorCtx());
    expect(handlerCalled).toBe(true);
    expect(ret).toEqual({ result: { exitCode: 99, stdout: "caught", stderr: "" } });
  });

  test("aclDenied 플래그가 ErrorCtx에 전달됨", async () => {
    const reg = new Registry();
    let receivedAclDenied: boolean | undefined;

    reg.register({
      name: "ext",
      init(api) {
        api.registerErrorHandler(async (ctx) => {
          receivedAclDenied = ctx.aclDenied;
        });
      },
    });
    await reg.initAll();

    await reg.runErrorHandlers(makeErrorCtx({ aclDenied: true }));
    expect(receivedAclDenied).toBe(true);
  });

  test("{ rethrow } 반환 시 해당 값이 반환됨", async () => {
    const reg = new Registry();
    const wrappedError = new Error("wrapped");

    reg.register({
      name: "ext",
      init(api) {
        api.registerErrorHandler(async () => ({ rethrow: wrappedError }));
      },
    });
    await reg.initAll();

    const ret = await reg.runErrorHandlers(makeErrorCtx());
    expect(ret).toEqual({ rethrow: wrappedError });
  });

  test("핸들러가 void 반환 시 다음 핸들러로 계속", async () => {
    const reg = new Registry();
    const called: number[] = [];

    reg.register({
      name: "ext",
      init(api) {
        api.registerErrorHandler(
          async () => {
            called.push(1);
          },
          { priority: 10 },
        );
        api.registerErrorHandler(
          async () => {
            called.push(2);
            return { result: { exitCode: 1, stdout: "", stderr: "handled" } };
          },
          { priority: 20 },
        );
      },
    });
    await reg.initAll();

    await reg.runErrorHandlers(makeErrorCtx());
    expect(called).toEqual([1, 2]);
  });
});

// --- init/dispose lifecycle ---

describe("Registry / lifecycle", () => {
  test("initAll이 각 extension의 init을 순서대로 호출", async () => {
    const reg = new Registry();
    const order: string[] = [];

    reg.register({
      name: "a",
      init() {
        order.push("a");
      },
    });
    reg.register({
      name: "b",
      init() {
        order.push("b");
      },
    });
    await reg.initAll();

    expect(order).toEqual(["a", "b"]);
  });

  test("disposeAll이 역순으로 dispose 호출", async () => {
    const reg = new Registry();
    const order: string[] = [];

    reg.register({
      name: "a",
      init() {},
      dispose() {
        order.push("a");
      },
    });
    reg.register({
      name: "b",
      init() {},
      dispose() {
        order.push("b");
      },
    });
    await reg.initAll();
    await reg.disposeAll();

    expect(order).toEqual(["b", "a"]);
  });

  test("disposeAll은 idempotent (두 번 호출해도 한 번만 dispose)", async () => {
    const reg = new Registry();
    let count = 0;

    reg.register({
      name: "a",
      init() {},
      dispose() {
        count++;
      },
    });
    await reg.initAll();
    await reg.disposeAll();
    await reg.disposeAll();

    expect(count).toBe(1);
  });

  test("dispose 없는 extension도 disposeAll 정상 완료", async () => {
    const reg = new Registry();
    reg.register({ name: "no-dispose", init() {} });
    await reg.initAll();
    await expect(reg.disposeAll()).resolves.toBeUndefined();
  });
});

// --- initAll 멱등성 ---

describe("Registry / initAll 멱등성", () => {
  test("두 번 호출해도 init은 한 번만 실행", async () => {
    const reg = new Registry();
    let count = 0;

    reg.register({
      name: "ext",
      init() {
        count++;
      },
    });

    await reg.initAll();
    await reg.initAll();

    expect(count).toBe(1);
  });
});

// --- 중복 등록 거부 ---

describe("Registry / 중복 등록 거부", () => {
  test("같은 name extension 두 번 등록 → throw", () => {
    const reg = new Registry();
    reg.register({ name: "dup", init() {} });
    expect(() => reg.register({ name: "dup", init() {} })).toThrow("already registered");
  });

  test("같은 type 두 번 registerTargetType → throw", async () => {
    const reg = new Registry();
    const def = {
      type: "same-type",
      schema: {} as never,
      executor: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    };

    reg.register({
      name: "ext1",
      init(api) {
        api.registerTargetType(def);
      },
    });
    reg.register({
      name: "ext2",
      init(api) {
        api.registerTargetType(def);
      },
    });

    await expect(reg.initAll()).rejects.toThrow("already registered");
  });

  test("allowTypeOverride() 호출 시 builtin type을 user extension이 override 가능 (경고만)", async () => {
    const reg = new Registry();
    const def1 = {
      type: "override-type",
      schema: {} as never,
      executor: async () => ({ exitCode: 0, stdout: "v1", stderr: "" }),
    };
    const def2 = {
      type: "override-type",
      schema: {} as never,
      executor: async () => ({ exitCode: 0, stdout: "v2", stderr: "" }),
    };

    // builtin:* extension이 먼저 type을 소유
    reg.register({
      name: "builtin:ext1",
      init(api) {
        api.registerTargetType(def1);
      },
    });
    // user extension이 override 시도 — manifest에서 허가한 경우
    reg.allowTypeOverride("override-type");
    reg.register({
      name: "user:ext2",
      init(api) {
        api.registerTargetType(def2);
      },
    });

    await expect(reg.initAll()).resolves.toBeUndefined();
    // 마지막 등록(user)이 승리
    const t = reg.getTargetType("override-type");
    expect(t).toBeDefined();
  });

  test("allowTypeOverride() 없이 builtin type을 user extension이 override 시도 → throw", async () => {
    const reg = new Registry();
    const def1 = {
      type: "protected-type",
      schema: {} as never,
      executor: async () => ({ exitCode: 0, stdout: "v1", stderr: "" }),
    };
    const def2 = {
      type: "protected-type",
      schema: {} as never,
      executor: async () => ({ exitCode: 0, stdout: "v2", stderr: "" }),
    };

    reg.register({
      name: "builtin:ext1",
      init(api) {
        api.registerTargetType(def1);
      },
    });
    reg.register({
      name: "user:ext2",
      init(api) {
        api.registerTargetType(def2);
      },
    });

    await expect(reg.initAll()).rejects.toThrow("owned by a builtin extension");
  });

  test("allowVerbOverride() 없이 builtin verb를 user extension이 탈취 시도 → throw", async () => {
    const reg = new Registry();

    reg.register({
      name: "builtin:cmds",
      init(api) {
        api.registerInternalCommand("myverb", async () => {});
      },
    });
    reg.register({
      name: "user:ext",
      init(api) {
        api.registerInternalCommand("myverb", async () => {});
      },
    });

    await expect(reg.initAll()).rejects.toThrow("owned by a builtin extension");
  });

  test("allowVerbOverride() 호출 시 builtin verb를 user extension이 override 가능", async () => {
    const reg = new Registry();

    reg.register({
      name: "builtin:cmds",
      init(api) {
        api.registerInternalCommand("myverb", async () => {});
      },
    });
    reg.allowVerbOverride("myverb");
    reg.register({
      name: "user:ext",
      init(api) {
        api.registerInternalCommand("myverb", async () => {});
      },
    });

    await expect(reg.initAll()).resolves.toBeUndefined();
    expect(reg.getInternalCommand("myverb")).toBeDefined();
  });
});

// --- hooks 결과 머지 ---

describe("Registry / hooks 결과 머지", () => {
  test("여러 훅의 headers가 머지됨", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => ({ headers: { a: "1" } }), { priority: 10 });
        api.registerHook("target-start", async () => ({ headers: { b: "2" } }), { priority: 20 });
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("target-start", makeCtx());
    expect(ret).toEqual({ headers: { a: "1", b: "2" } });
  });

  test("나중 훅의 header 값이 앞 훅을 덮어씀", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => ({ headers: { auth: "v1" } }), { priority: 10 });
        api.registerHook("target-start", async () => ({ headers: { auth: "v2" } }), { priority: 20 });
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("target-start", makeCtx());
    expect(ret).toEqual({ headers: { auth: "v2" } });
  });

  test("target-end result 부분 머지", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-end", async () => ({ result: { stdout: "modified" } }));
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks(
      "target-end",
      makeCtx({
        phase: "target-end",
        result: { exitCode: 0, stdout: "original", stderr: "" },
      }),
    );
    expect(ret).toEqual({ result: { stdout: "modified" } });
  });

  test("훅이 하나도 없으면 null 반환", async () => {
    const reg = new Registry();
    reg.register({ name: "empty", init() {} });
    await reg.initAll();

    expect(await reg.runHooks("target-start", makeCtx())).toBeNull();
  });

  test("target-end 낮은 priority 훅이 나중에 실행되어 같은 키를 덮어씀", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        // priority 20 → 역순이므로 먼저 실행
        api.registerHook("target-end", async () => ({ result: { stdout: "high-prio" } }), { priority: 20 });
        // priority 10 → 나중에 실행 → 동일 키는 이 값이 승리
        api.registerHook("target-end", async () => ({ result: { stdout: "low-prio" } }), { priority: 10 });
      },
    });
    await reg.initAll();

    const ret = await reg.runHooks("target-end", makeCtx({ phase: "target-end" }));
    expect(ret).toEqual({ result: { stdout: "low-prio" } });
  });

  test("훅들이 모두 void 반환하면 null 반환", async () => {
    const reg = new Registry();

    reg.register({
      name: "ext",
      init(api) {
        api.registerHook("target-start", async () => {
          /* no return */
        });
      },
    });
    await reg.initAll();

    expect(await reg.runHooks("target-start", makeCtx())).toBeNull();
  });
});
