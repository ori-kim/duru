import type { OptionDefinition } from "./options.ts";

export type CommandExample =
  | string
  | {
      command: string;
      description?: string;
    };

export interface CommandMetaFields {
  description: string;
  aliases: readonly string[];
  examples: readonly CommandExample[];
  usage: string;
  hidden: boolean;
  deprecated: boolean | string;
  group: string;
}

export type CommandMeta = {
  [K in keyof CommandMetaFields]?: CommandMetaFields[K];
};

export type CommandMetadata = CommandMeta;

export type HelpRoute = {
  pattern: string;
  description?: string;
  options: readonly OptionDefinition[];
} & CommandMetadata;

export type HelpDocument = {
  name: string;
  path: readonly string[];
  globalOptions: readonly OptionDefinition[];
  routes: readonly HelpRoute[];
};
