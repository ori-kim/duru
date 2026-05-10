import { describe, expect, test } from "bun:test";
import { ClipError } from "./errors.ts";
import {
  DEFAULT_TARGET_TIMEOUT_MS,
  formatTimeoutMs,
  resolveTargetTimeoutMs,
  waitForProcessExit,
  withTargetTimeoutSignal,
} from "./timeout.ts";

describe("target timeout", () => {
  test("defaults to 30 seconds", () => {
    expect(resolveTargetTimeoutMs(undefined, {})).toBe(DEFAULT_TARGET_TIMEOUT_MS);
  });

  test("CLIP_TARGET_TIMEOUT_MS overrides the default", () => {
    expect(resolveTargetTimeoutMs(undefined, { CLIP_TARGET_TIMEOUT_MS: "12000" })).toBe(12_000);
  });

  test("target timeoutMs has priority over environment", () => {
    expect(resolveTargetTimeoutMs({ timeoutMs: 5_000 }, { CLIP_TARGET_TIMEOUT_MS: "12000" })).toBe(5_000);
  });

  test("rejects invalid environment values", () => {
    expect(() => resolveTargetTimeoutMs(undefined, { CLIP_TARGET_TIMEOUT_MS: "nope" })).toThrow(ClipError);
  });

  test("formats second-aligned and raw millisecond values", () => {
    expect(formatTimeoutMs(30_000)).toBe("30s");
    expect(formatTimeoutMs(1_500)).toBe("1500ms");
  });

  test("withTargetTimeoutSignal returns successful work before the deadline", async () => {
    await expect(withTargetTimeoutSignal(100, "fast task", async () => "ok")).resolves.toBe("ok");
  });

  test("withTargetTimeoutSignal fails with exit code 124 after the deadline", async () => {
    const promise = withTargetTimeoutSignal(10, "slow task", () => new Promise((resolve) => setTimeout(resolve, 100)));

    await expect(promise).rejects.toMatchObject({
      name: "ClipError",
      exitCode: 124,
      message: "slow task timed out after 10ms",
    });
  });

  test("waitForProcessExit preserves normal exit codes", async () => {
    const proc = Bun.spawn(["bun", "-e", "process.exit(7)"]);

    await expect(waitForProcessExit(proc, 1_000)).resolves.toEqual({ exitCode: 7, timedOut: false });
  });

  test("waitForProcessExit terminates timed-out processes with exit code 124", async () => {
    const proc = Bun.spawn(["bun", "-e", "setTimeout(() => {}, 1000)"]);

    await expect(waitForProcessExit(proc, 10)).resolves.toEqual({ exitCode: 124, timedOut: true });
  });
});
