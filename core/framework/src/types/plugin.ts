import type { EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { Middleware } from "./middleware.ts";
import type { OptionDefinition, Options } from "./options.ts";
import type { Renderer } from "./renderer.ts";

declare const pluginTag: unique symbol;
declare const pluginOptionsTag: unique symbol;

export type CliPlugin<TOptions extends Options = EmptyObject> = {
  readonly [pluginTag]: true;
  readonly [pluginOptionsTag]?: (options: TOptions) => TOptions;
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
