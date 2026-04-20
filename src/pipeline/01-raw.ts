import type { RawInvocation } from "./types.ts";

export function createRawInvocation(argv: string[], env: Record<string, string | undefined>): RawInvocation {
  return Object.freeze({
    argv: Object.freeze([...argv]) as readonly string[],
    env: Object.freeze({ ...env }) as Readonly<Record<string, string>>,
    at: Date.now(),
  }) as unknown as RawInvocation;
}
