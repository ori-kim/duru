import { createOutputWriter } from "../output/index.ts";
import type { Context, Options } from "../types/index.ts";

export function createContext(
  argv: readonly string[],
  parsedOptions: Options,
  positionals: readonly string[],
  services = new Map<string, unknown>(),
): Context {
  return {
    request: { argv, pattern: "", params: {}, options: parsedOptions, positionals },
    params: {},
    options: parsedOptions,
    output: createOutputWriter(),
    state: new Map(),
    service<T>(key: string): T | undefined {
      return services.get(key) as T | undefined;
    },
    setService<T>(key: string, value: T): void {
      services.set(key, value);
    },
  };
}

export function createEmptyContext(argv: readonly string[]): Context {
  return {
    request: { argv, pattern: "", params: {}, options: {}, positionals: [] },
    params: {},
    options: {},
    output: createOutputWriter(),
    state: new Map(),
    service() {
      return undefined;
    },
    setService() {},
  };
}
