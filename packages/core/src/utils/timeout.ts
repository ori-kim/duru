import { ClipError } from "./errors.ts";

export const DEFAULT_TARGET_TIMEOUT_MS = 30_000;
export const CLIP_TARGET_TIMEOUT_ENV = "CLIP_TARGET_TIMEOUT_MS";

export type HasTargetTimeout = {
  timeoutMs?: number;
};

export type TimeoutProcess = {
  exited: Promise<number>;
  kill: (signal?: string) => unknown;
};

function parsePositiveMs(value: number | string, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ClipError(`${label} must be a positive number of milliseconds`);
  }
  return Math.ceil(n);
}

export function resolveTargetTimeoutMs(
  target: HasTargetTimeout | undefined,
  env: Record<string, string | undefined> = process.env,
): number {
  if (target?.timeoutMs !== undefined) {
    return parsePositiveMs(target.timeoutMs, "timeoutMs");
  }

  const envValue = env[CLIP_TARGET_TIMEOUT_ENV];
  if (envValue !== undefined && envValue !== "") {
    return parsePositiveMs(envValue, CLIP_TARGET_TIMEOUT_ENV);
  }

  return DEFAULT_TARGET_TIMEOUT_MS;
}

export function formatTimeoutMs(timeoutMs: number): string {
  if (timeoutMs % 1000 === 0) return `${timeoutMs / 1000}s`;
  return `${timeoutMs}ms`;
}

export function targetTimeoutMessage(label: string, timeoutMs: number): string {
  return `${label} timed out after ${formatTimeoutMs(timeoutMs)}`;
}

export async function withTargetTimeoutSignal<T>(
  timeoutMs: number,
  label: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ac = new AbortController();
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      ac.abort(new Error(targetTimeoutMessage(label, timeoutMs)));
      reject(new ClipError(targetTimeoutMessage(label, timeoutMs), 124));
    }, timeoutMs);
  });

  try {
    return await Promise.race([run(ac.signal), timeout]);
  } catch (e) {
    if (timedOut || ac.signal.aborted) {
      throw new ClipError(targetTimeoutMessage(label, timeoutMs), 124);
    }
    throw e;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function waitForProcessExit(
  proc: TimeoutProcess,
  timeoutMs: number,
): Promise<{ exitCode: number; timedOut: boolean }> {
  let timedOut = false;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;

  const timeoutId = setTimeout(() => {
    timedOut = true;
    try {
      proc.kill("SIGTERM");
    } catch {
      proc.kill();
    }
    forceKillId = setTimeout(() => {
      try {
        proc.kill("SIGKILL");
      } catch {
        proc.kill();
      }
    }, 2_000);
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    return { exitCode: timedOut ? 124 : exitCode, timedOut };
  } finally {
    clearTimeout(timeoutId);
    if (forceKillId) clearTimeout(forceKillId);
  }
}
