import { describe, expect, spyOn, test } from "bun:test";
import type { Config } from "../config.ts";
import { Registry } from "../extension.ts";
import type { TargetResult } from "../extension.ts";
import { bindTarget } from "./04-bind-target.ts";
import type { TargetInvocationHandle } from "./types.ts";

// --- helpers ---

type BoundData = {
  invocation: TargetInvocationHandle;
  type: string;
  rawTarget: unknown;
  configDir: string;
};

const noop = async (): Promise<TargetResult> => ({ exitCode: 0, stdout: "", stderr: "" });
const noopSchema = { safeParse: (x: unknown) => ({ success: true as const, data: x }) };

function makeInvocation(baseName: string, explicitProfile?: string): TargetInvocationHandle {
  return {
    baseName,
    explicitProfile,
    token: explicitProfile ? `${baseName}@${explicitProfile}` : baseName,
    userArgs: [],
    lateFlags: { jsonMode: false, pipeMode: false, dryRun: false },
    subcommand: undefined,
    targetArgs: [],
  };
}

async function makeRegistry(types: string[]): Promise<Registry> {
  const reg = new Registry();
  for (const type of types) {
    reg.register({
      name: `mock:${type}`,
      init(api) {
        api.registerTargetType({ type, schema: noopSchema, executor: noop });
      },
    });
  }
  await reg.initAll();
  return reg;
}

const BUILTIN_TYPES = ["cli", "mcp", "api", "grpc", "graphql", "script"];

const notionTarget = { transport: "http", url: "https://mcp.notion.com/mcp", auth: false };

const baseConfig: Config = {
  headers: {},
  targets: {
    cli: { mygh: { command: "gh" } },
    mcp: { notion: notionTarget },
    api: { petstore: { baseUrl: "https://petstore.example.com", openapiUrl: "https://petstore.example.com/spec.json", auth: false } },
    grpc: { localgrpc: { address: "localhost:50051", plaintext: true } },
    graphql: { gh: { endpoint: "https://api.github.com/graphql" } },
    script: { lag: { commands: { run: { script: "echo hi" } } } },
  },
  _ext: { mytype: { mytarget: { host: "localhost" } } },
};

// --- builtin target 정상 bind ---

describe("builtin targets", () => {
  test.each(BUILTIN_TYPES)("%s target binds successfully", async (type) => {
    const reg = await makeRegistry(BUILTIN_TYPES);
    const name = Object.keys((baseConfig.targets[type] ?? {}) as Record<string, unknown>)[0]!;
    const inv = makeInvocation(name);
    const bound = bindTarget(inv, baseConfig, reg) as unknown as BoundData;

    expect(bound.type).toBe(type);
    expect(bound.configDir).toContain(type);
    expect(bound.configDir).toContain(name);
    expect(bound.invocation).toBe(inv);
  });

  test("configDir follows ~/.clip/target/<type>/<name> pattern", async () => {
    const reg = await makeRegistry(BUILTIN_TYPES);
    const bound = bindTarget(makeInvocation("mygh"), baseConfig, reg) as unknown as BoundData;
    expect(bound.configDir).toMatch(/\.clip\/target\/cli\/mygh$/);
  });
});

// --- extension target 정상 bind ---

describe("extension target", () => {
  test("extension target binds with correct type", async () => {
    const reg = await makeRegistry([...BUILTIN_TYPES, "mytype"]);
    const bound = bindTarget(makeInvocation("mytarget"), baseConfig, reg) as unknown as BoundData;

    expect(bound.type).toBe("mytype");
    expect(bound.rawTarget).toEqual({ host: "localhost" });
    expect(bound.configDir).toContain("mytype/mytarget");
  });
});

// --- target 미존재 → 에러 ---

describe("target not found", () => {
  test("unknown target calls die (process.exit)", async () => {
    const reg = await makeRegistry(BUILTIN_TYPES);
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    try {
      expect(() => bindTarget(makeInvocation("nonexistent"), baseConfig, reg)).toThrow();
    } finally {
      exitSpy.mockRestore();
    }
  });
});

// --- Unknown target type → 에러 ---

describe("unknown target type", () => {
  test("extension target not in registry throws Unknown target type", async () => {
    // mytype은 registry에 없음
    const reg = await makeRegistry(BUILTIN_TYPES);
    expect(() => bindTarget(makeInvocation("mytarget"), baseConfig, reg)).toThrow(`Unknown target type: "mytype"`);
  });
});

// --- rawTarget 전달 확인 ---

describe("rawTarget passthrough", () => {
  test("rawTarget is the original config object", async () => {
    const reg = await makeRegistry(BUILTIN_TYPES);
    const bound = bindTarget(makeInvocation("notion"), baseConfig, reg) as unknown as BoundData;
    expect(bound.rawTarget).toEqual(notionTarget);
  });
});

// --- profile 포함 invocation ---

describe("profile in invocation", () => {
  test("explicitProfile is preserved in bound.invocation", async () => {
    const reg = await makeRegistry(BUILTIN_TYPES);
    const inv = makeInvocation("mygh", "dev");
    const bound = bindTarget(inv, baseConfig, reg) as unknown as BoundData;
    expect(bound.invocation.explicitProfile).toBe("dev");
  });
});
