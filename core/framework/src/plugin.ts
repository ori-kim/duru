import type { OptionDefinition } from "./options.ts";
import { parseOptionSpec } from "./options.ts";
import type { Context, EmptyObject, Middleware, OptionSpecOptions, Options, Renderer } from "./types.ts";

const pluginTag = Symbol("clip.plugin");

export type CliPlugin<TOptions extends Options = EmptyObject> = {
  readonly [pluginTag]: true;
  install(api: CliPluginApi): void;
};

export type CliPluginApi = {
  option(definition: OptionDefinition): void;
  options(): readonly OptionDefinition[];
  middleware(middleware: Middleware): void;
  renderer(renderer: Renderer): void;
  defaultRenderer(id: string): void;
  selectRenderer(selector: (ctx: Context) => string | undefined): void;
  usage(provider: (name: string) => string): void;
};

export function createPlugin<TOptions extends Options = EmptyObject>(
  install: (api: CliPluginApi) => void,
): CliPlugin<TOptions> {
  return { [pluginTag]: true, install };
}

export function isCliPlugin(value: unknown): value is CliPlugin<Options> {
  return typeof value === "object" && value !== null && pluginTag in value;
}

export function option<TSpec extends string>(spec: TSpec, description?: string): CliPlugin<OptionSpecOptions<TSpec>> {
  return createPlugin((api) => {
    api.option(parseOptionSpec(spec, description));
  });
}

export function renderer(...renderers: Renderer[]): CliPlugin<{ json?: boolean }> {
  return createPlugin((api) => {
    for (const item of renderers) {
      api.renderer(item);
    }
    const ids = renderers.map((item) => item.id);
    const defaultId = ids.includes("text") ? "text" : ids[0];
    if (defaultId) api.defaultRenderer(defaultId);
    if (ids.includes("json")) {
      api.option(parseOptionSpec("--json", "Render structured JSON output"));
      api.selectRenderer((ctx) => (ctx.options.json ? "json" : undefined));
    }
  });
}
