import type { OptionDefinition } from "./options.ts";

export type HelpRoute = {
  pattern: string;
  description?: string;
  options: readonly OptionDefinition[];
};

export type HelpDocument = {
  name: string;
  path: readonly string[];
  globalOptions: readonly OptionDefinition[];
  routes: readonly HelpRoute[];
};
