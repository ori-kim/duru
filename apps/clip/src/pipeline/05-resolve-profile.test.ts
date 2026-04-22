import { describe, expect, test } from "bun:test";
import { Registry } from "@clip/core";
import type { TargetResult } from "@clip/core";
import { bindTarget } from "./04-bind-target.ts";
import { resolveProfileStage } from "./05-resolve-profile.ts";
import type { TargetInvocationHandle } from "./types.ts";

// --- helpers ---

type MergedData = {
  invocation: TargetInvocationHandle;
  type: string;
  target: unknown;
  profileName: string | undefined;
};

const noop = async (): Promise<TargetResult> => ({ exitCode: 0, stdout: "", stderr: "" });

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

async function makeRegistry(
  extraTypes: { type: string; schema?: { safeParse: (x: unknown) => { success: true; data: unknown } | { success: false; error: { message: string } } } }[] = [],
): Promise<Registry> {
  const reg = new Registry();
  const builtins = ["cli", "mcp", "api", "grpc", "graphql", "script"];
  for (const type of builtins) {
    reg.register({
      name: `mock:${type}`,
      init(api) {
        api.registerTargetType({ type, schema: { safeParse: (x) => ({ success: true as const, data: x }) }, executor: noop });
      },
    });
  }
  for (const { type, schema } of extraTypes) {
    reg.register({
      name: `mock:${type}`,
      init(api) {
        api.registerTargetType({
          type,
          schema: schema ?? { safeParse: (x) => ({ success: true as const, data: x }) },
          executor: noop,
        });
      },
    });
  }
  await reg.initAll();
  return reg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeConfig(type: string, name: string, target: any) {
  const builtinTypes = new Set(["cli", "mcp", "api", "grpc", "graphql", "script"]);
  if (builtinTypes.has(type)) {
    return { targets: { [type]: { [name]: target } }, _ext: {} };
  }
  return { targets: {}, _ext: { [type]: { [name]: target } } };
}

// --- profile 없음 → identity ---

describe("no profile", () => {
  test("no active profile → merged === rawTarget", async () => {
    const reg = await makeRegistry();
    const target = { command: "gh" };
    const config = makeConfig("cli", "kube", target);
    const inv = makeInvocation("kube");
    const bound = bindTarget(inv, config as never, reg);
    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;

    expect(merged.target).toEqual(target);
    expect(merged.profileName).toBeUndefined();
  });
});

// --- profile 적용 ---

describe("profile application", () => {
  test("explicit profile overrides fields", async () => {
    const reg = await makeRegistry();
    const target = {
      command: "gh",
      profiles: { dev: { args: ["--context", "dev-cluster"] } },
    };
    const config = makeConfig("cli", "kube", target);
    const inv = makeInvocation("kube", "dev");
    const bound = bindTarget(inv, config as never, reg);
    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;
    const t = merged.target as typeof target & { args: string[] };

    expect(merged.profileName).toBe("dev");
    expect(t.args).toEqual(["--context", "dev-cluster"]);
  });

  test("active profile auto-applied when no explicit profile", async () => {
    const reg = await makeRegistry();
    const target = {
      command: "gh",
      active: "prod",
      profiles: { prod: { args: ["--context", "prod-cluster"] } },
    };
    const config = makeConfig("cli", "kube", target);
    const inv = makeInvocation("kube"); // no explicit profile
    const bound = bindTarget(inv, config as never, reg);
    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;
    const t = merged.target as typeof target & { args: string[] };

    expect(merged.profileName).toBe("prod");
    expect(t.args).toEqual(["--context", "prod-cluster"]);
  });

  test("headers merged (profile on top of base)", async () => {
    const reg = await makeRegistry();
    const target = {
      transport: "http" as const,
      url: "https://api.example.com",
      auth: false as const,
      headers: { "X-Base": "base" },
      profiles: { bot: { headers: { "Authorization": "Bearer token" } } },
    };
    const config = makeConfig("mcp", "myapi", target);
    const inv = makeInvocation("myapi", "bot");
    const bound = bindTarget(inv, config as never, reg);
    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;
    const t = merged.target as { headers: Record<string, string> };

    expect(t.headers["X-Base"]).toBe("base");
    expect(t.headers["Authorization"]).toBe("Bearer token");
  });

  test("explicit profile wins over active", async () => {
    const reg = await makeRegistry();
    const target = {
      command: "gh",
      active: "dev",
      profiles: {
        dev: { args: ["--context", "dev"] },
        prod: { args: ["--context", "prod"] },
      },
    };
    const config = makeConfig("cli", "kube", target);
    const inv = makeInvocation("kube", "prod"); // explicit = prod
    const bound = bindTarget(inv, config as never, reg);
    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;
    const t = merged.target as { args: string[] };

    expect(merged.profileName).toBe("prod");
    expect(t.args).toEqual(["--context", "prod"]);
  });
});

// --- extension target full schema 검증 ---

describe("extension target schema validation", () => {
  test("valid extension target passes full schema check", async () => {
    const schema = {
      safeParse: (x: unknown) => {
        const obj = x as Record<string, unknown>;
        if (obj["host"]) return { success: true as const, data: x };
        return { success: false as const, error: { message: "host required" } };
      },
    };
    const reg = await makeRegistry([{ type: "mytype", schema }]);
    const target = { host: "localhost" };
    const config = makeConfig("mytype", "mytarget", target);
    const inv = makeInvocation("mytarget");
    const bound = bindTarget(inv, config as never, reg);

    expect(() => resolveProfileStage(bound, reg)).not.toThrow();
  });

  test("extension target fails full schema check → formatted error", async () => {
    const schema = {
      safeParse: (x: unknown) => {
        const obj = x as Record<string, unknown>;
        if (obj["host"]) return { success: true as const, data: x };
        return { success: false as const, error: { message: "host required" } };
      },
    };
    const reg = await makeRegistry([{ type: "mytype", schema }]);
    const target = { port: 8080 }; // host 누락
    const config = makeConfig("mytype", "mytarget", target);
    const inv = makeInvocation("mytarget");
    const bound = bindTarget(inv, config as never, reg);

    expect(() => resolveProfileStage(bound, reg)).toThrow(
      "mytarget: invalid config after profile merge: host required",
    );
  });

  test("extension partial config + profile fills required field → full validation passes", async () => {
    const schema = {
      safeParse: (x: unknown) => {
        const obj = x as Record<string, unknown>;
        if (obj["host"]) return { success: true as const, data: x };
        return { success: false as const, error: { message: "host required" } };
      },
    };
    const reg = await makeRegistry([{ type: "mytype", schema }]);
    // rawTarget에 host 없음 (partial), profile로 채움
    const target = {
      port: 8080,
      profiles: { prod: { host: "prod.example.com" } },
    };
    const config = makeConfig("mytype", "mytarget", target);
    const inv = makeInvocation("mytarget", "prod");
    const bound = bindTarget(inv, config as never, reg);

    const merged = resolveProfileStage(bound, reg) as unknown as MergedData;
    const t = merged.target as { host: string; port: number };
    expect(t.host).toBe("prod.example.com");
    expect(t.port).toBe(8080);
  });
});
