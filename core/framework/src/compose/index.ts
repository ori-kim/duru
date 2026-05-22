import { createPlugin } from "../plugin/index.ts";
import type { CommandComposer } from "../types/index.ts";

export const commandAliasesComposer: CommandComposer = (command, next) => {
  for (const alias of command.meta.aliases ?? []) command.alias(alias);
  next();
};

export function commandAliases() {
  return createPlugin((api) => {
    api.compose(commandAliasesComposer);
  });
}
