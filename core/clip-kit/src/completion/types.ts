import type { Awaitable } from "../types/common.ts";

export type CompletionContext = {
  argv: readonly string[];
  cursor: number;
  current: string;
  previous?: string;
  position: number;
};

export type CompletionItem = {
  value: string;
  description?: string;
  kind?: "command" | "option" | "target" | "profile" | "alias" | "operation" | "file" | "value";
  group?: string;
  hidden?: boolean;
};

export type CompletionContributor = {
  id: string;
  complete(ctx: CompletionContext): Awaitable<readonly CompletionItem[]>;
};

export type CompletionContributorError = {
  contributor: string;
  message: string;
};

export type CompletionResult = {
  items: readonly CompletionItem[];
  errors: readonly CompletionContributorError[];
};

export type CompletionOptions = {
  debug?: boolean;
};
