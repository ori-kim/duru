import { describe, expect, test } from "bun:test";
import type { ExtensionApi, HookFn, HookPhase } from "@clip/core";
import { extension } from "./extension.ts";

describe("sanitizer extension", () => {
  test("registers an subcommand-end hook that sanitizes results", async () => {
    let registeredPhase: HookPhase | undefined;
    let registeredHook: HookFn | undefined;

    await extension.init({
      registerHook(phase, fn) {
        registeredPhase = phase;
        registeredHook = fn;
      },
    } as Partial<ExtensionApi> as ExtensionApi);

    expect(registeredPhase).toBe("subcommand-end");
    const result = await registeredHook?.({
      phase: "subcommand-end",
      kind: "target",
      command: "demo",
      targetName: "demo",
      targetType: "api",
      target: {},
      subcommand: "get",
      subcommandIndex: 1,
      args: [],
      globalOptions: {},
      headers: {},
      dryRun: false,
      jsonMode: false,
      passthrough: false,
      result: { exitCode: 0, stdout: "Authorization: Bearer abcdefghijklmnop", stderr: "" },
    });

    expect(result).toMatchObject({
      result: {
        stdout: "Authorization: Bearer [REDACTED]",
      },
    });
  });
});
