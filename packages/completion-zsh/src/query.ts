import type { CompletionContext, CompletionItem, CompletionResult } from "@duru/cli-kit";
import type { CompletionQueryOptions, CompletionQueryOutput } from "./types";

export type CompletionQueryRunnerOptions = CompletionQueryOptions & {
  complete(ctx: CompletionContext): Promise<CompletionResult>;
};

export async function queryCompletionItems(options: CompletionQueryRunnerOptions): Promise<CompletionQueryOutput> {
  const result = await options.complete(completionContextFromWords(options));
  return { items: result.items.map(publicCompletionItem) };
}

export function completionContextFromWords(options: CompletionQueryOptions): CompletionContext {
  const words = [...options.words];
  const rawCursor = options.cursor ?? words.length;
  const cursor = clamp(rawCursor, 1, Math.max(words.length, 1));
  const commandOffset = words[0] === options.commandName ? 1 : 0;
  const argv = words.slice(commandOffset);
  const position = clamp(cursor - 1 - commandOffset, 0, Math.max(argv.length - 1, 0));
  const current = argv[position] ?? "";

  return {
    argv,
    cursor: Math.max(0, cursor - commandOffset),
    current,
    previous: position > 0 ? argv[position - 1] : undefined,
    position,
  };
}

function publicCompletionItem(item: CompletionItem): CompletionItem {
  const next: CompletionItem = { value: item.value };
  if (item.description) next.description = item.description;
  if (item.kind) next.kind = item.kind;
  if (item.group) next.group = item.group;
  return next;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
