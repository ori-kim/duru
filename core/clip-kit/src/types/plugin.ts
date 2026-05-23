import type { Cli } from "./cli.ts";
import type { EmptyObject } from "./common.ts";
import type { Context } from "./context.ts";
import type { CliEventHandler } from "./event.ts";
import type { CommandMeta, HelpDocument, HelpRoute } from "./help.ts";
import type { Middleware } from "./middleware.ts";
import type { OptionDefinition, OptionFallbackProvider, Options } from "./options.ts";
import type { Renderer } from "./renderer.ts";

declare const pluginTag: unique symbol;
declare const pluginOptionsTag: unique symbol;
declare const pluginContextTag: unique symbol;

export type CliPlugin<TOptions extends Options = EmptyObject, TValues extends object = EmptyObject> = {
  readonly [pluginTag]: true;
  readonly [pluginOptionsTag]?: (options: TOptions) => TOptions;
  readonly [pluginContextTag]?: (values: TValues) => TValues;
  install(api: CliPluginApi): void;
};

export type CliPluginApi = {
  command: Cli["command"];
  route: Cli["route"];
  option(definition: OptionDefinition): void;
  options(): readonly OptionDefinition[];
  optionFallback(provider: OptionFallbackProvider): void;
  optionFallbacks(): readonly OptionFallbackProvider[];
  middleware(middleware: Middleware): void;
  renderer(renderer: Renderer): void;
  defaultRenderer(id: string): void;
  selectRenderer(selector: (ctx: Context) => string | undefined): void;
  on(name: string, handler: CliEventHandler): void;
  compose(composer: CommandComposer): void;
  composers(): readonly CommandComposer[];
  helpDocument(argv: readonly string[]): HelpDocument;
  helpRoutes(provider: () => readonly HelpRoute[]): void;
  usage(provider: (name: string) => string): void;
};

export type CommandDraft = {
  readonly pattern: string;
  readonly meta: Readonly<CommandMeta>;
  readonly options: readonly OptionDefinition[];
  alias(pattern: string): void;
  use(middleware: Middleware): void;
  mergeMeta(metadata: CommandMeta): void;
};

export type CommandComposer = (command: CommandDraft, next: () => void) => void;
