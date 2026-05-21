import type { Context, Options } from "../types/index.ts";

export function createContext(
  argv: readonly string[],
  parsedOptions: Options,
  positionals: readonly string[],
  services = new Map<string, unknown>(),
): Context {
  const events: unknown[] = [];
  return {
    request: { argv, pattern: "", params: {}, options: parsedOptions, positionals },
    params: {},
    options: parsedOptions,
    emit(event) {
      events.push(event);
    },
    events() {
      return [...events];
    },
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
  const events: unknown[] = [];
  return {
    request: { argv, pattern: "", params: {}, options: {}, positionals: [] },
    params: {},
    options: {},
    emit(event) {
      events.push(event);
    },
    events() {
      return [...events];
    },
    state: new Map(),
    service() {
      return undefined;
    },
    setService() {},
  };
}
