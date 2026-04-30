import { describe, expect, test } from "bun:test";
import type { ExtensionApi, HookFn, HookPhase } from "@clip/core";
import { extension } from "./extension.ts";

describe("sanitizer extension", () => {
  test("registers an afterExecute hook that sanitizes results", async () => {
    let registeredPhase: HookPhase | undefined;
    let registeredHook: HookFn | undefined;

    await extension.init({
      registerHook(phase, fn) {
        registeredPhase = phase;
        registeredHook = fn;
      },
    } as Partial<ExtensionApi> as ExtensionApi);

    expect(registeredPhase).toBe("afterExecute");
    const result = await registeredHook?.({
      phase: "afterExecute",
      targetName: "demo",
      targetType: "api",
      target: {},
      subcommand: "get",
      args: [],
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
