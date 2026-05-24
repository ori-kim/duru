import { parseOptionSpec } from "../options/index.ts";
import type {
  CliPlugin,
  CliPluginApi,
  EmptyObject,
  Middleware,
  OptionSpec,
  OptionSpecOptions,
  Options,
  Params,
  Renderer,
} from "../types/index.ts";

const pluginTag = Symbol.for("duru.plugin");

export function createPlugin<TOptions extends Options = EmptyObject, TValues extends object = EmptyObject>(
  install: (api: CliPluginApi) => void | Promise<void>,
): CliPlugin<TOptions, TValues> {
  return { [pluginTag]: true, install } as unknown as CliPlugin<TOptions, TValues>;
}

export function isCliPlugin(value: unknown): value is CliPlugin<Options, object> {
  return typeof value === "object" && value !== null && pluginTag in value;
}

export function option<TSpec extends string>(
  spec: OptionSpec<TSpec>,
  description?: string,
): CliPlugin<OptionSpecOptions<TSpec>> {
  return createPlugin((api) => {
    api.option(parseOptionSpec(spec, description));
  });
}

export function renderer(...renderers: Renderer[]): CliPlugin {
  return createPlugin((api) => {
    for (const item of renderers) {
      api.renderer(item);
    }
    const defaultId = renderers[0]?.id;
    if (defaultId) api.defaultRenderer(defaultId);
  });
}

export function context<TValues extends object>(
  middleware?: Middleware<Options, Params, TValues>,
): CliPlugin<EmptyObject, TValues> {
  return createPlugin<EmptyObject, TValues>((api) => {
    if (middleware) api.middleware(middleware as Middleware);
  });
}
