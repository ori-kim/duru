import { parseOptionSpec } from "../options/index.ts";
import type {
  CliPlugin,
  CliPluginApi,
  EmptyObject,
  Middleware,
  OptionSpecOptions,
  Options,
  Params,
  Renderer,
} from "../types/index.ts";

const pluginTag = Symbol("clip.plugin");

export function createPlugin<TOptions extends Options = EmptyObject, TValues extends object = EmptyObject>(
  install: (api: CliPluginApi) => void,
): CliPlugin<TOptions, TValues> {
  return { [pluginTag]: true, install } as unknown as CliPlugin<TOptions, TValues>;
}

export function isCliPlugin(value: unknown): value is CliPlugin<Options, object> {
  return typeof value === "object" && value !== null && pluginTag in value;
}

export function option<TSpec extends string>(spec: TSpec, description?: string): CliPlugin<OptionSpecOptions<TSpec>> {
  return createPlugin((api) => {
    api.option(parseOptionSpec(spec, description));
  });
}

export function renderer(...renderers: Renderer[]): CliPlugin<{ json?: boolean; events?: boolean }> {
  return createPlugin((api) => {
    for (const item of renderers) {
      api.renderer(item);
    }
    const ids = renderers.map((item) => item.id);
    const defaultId = ids.includes("text") ? "text" : ids[0];
    if (defaultId) api.defaultRenderer(defaultId);
    if (ids.includes("json")) {
      api.option(parseOptionSpec("--json", "Render structured JSON output"));
      api.option(parseOptionSpec("--events", "Include emitted events in structured JSON output"));
      api.selectRenderer((ctx) => (ctx.options.json ? "json" : undefined));
    }
  });
}

export function context<TValues extends object>(
  middleware?: Middleware<Options, Params, TValues>,
): CliPlugin<EmptyObject, TValues> {
  return createPlugin<EmptyObject, TValues>((api) => {
    if (middleware) api.middleware(middleware as Middleware);
  });
}
