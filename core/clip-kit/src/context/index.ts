import { exit } from "../result/index.ts";
import type { ActionResult, Awaitable, CliEventName, CliEventRecord, Context, RawOptions } from "../types/index.ts";

export type ContextEventSink = (ctx: Context, event: CliEventRecord) => Awaitable<ActionResult>;

export function createContext(
  argv: readonly string[],
  parsedOptions: RawOptions,
  positionals: readonly string[],
  services = new Map<string, unknown>(),
  eventSink?: ContextEventSink,
): Context {
  return createBaseContext(argv, parsedOptions, positionals, services, eventSink);
}

export function createEmptyContext(
  argv: readonly string[],
  services = new Map<string, unknown>(),
  eventSink?: ContextEventSink,
): Context {
  return createBaseContext(argv, {}, [], services, eventSink);
}

function createBaseContext(
  argv: readonly string[],
  parsedOptions: RawOptions,
  positionals: readonly string[],
  services: Map<string, unknown>,
  eventSink?: ContextEventSink,
): Context {
  const events: CliEventRecord[] = [];
  const values: Record<string, unknown> = {};
  const options = { ...parsedOptions } as Context["options"];

  const ctx: Context = {
    request: { argv, pattern: "", params: {}, options, positionals },
    raw: { argv, pattern: "", params: {}, options: parsedOptions, positionals },
    params: {},
    options,
    meta: {},
    var: values,
    async emit(name, payload) {
      const event = { name, payload } as CliEventRecord<CliEventName>;
      events.push(event);
      return eventSink?.(ctx, event);
    },
    events() {
      return [...events];
    },
    get(key) {
      return values[key] as never;
    },
    set(key, value) {
      values[key] = value;
    },
    exit(exitCode, result, ok) {
      return exit(exitCode, result, ok);
    },
    service<T>(key: string): T | undefined {
      return services.get(key) as T | undefined;
    },
    setService<T>(key: string, value: T): void {
      services.set(key, value);
    },
  };

  return ctx;
}
