import type { CompletionItem } from "@duru/cli-kit";

export type RenderZshCompletionOptions = {
  commandName?: string;
  queryCommand?: readonly string[];
  styles?: readonly ZshCompletionStyle[];
};

export type ZshCompletionStyle = {
  tag: string;
  format?: string;
  color?: string;
};

export type CompletionQueryOptions = {
  commandName: string;
  words: readonly string[];
  cursor?: number;
};

export type CompletionQueryOutput = {
  items: readonly CompletionItem[];
};
