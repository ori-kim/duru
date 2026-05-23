import type { CompletionItem } from "@clip/kit";

export function zshSingleQuote(value: string): string {
  return `'${sanitizeLine(value).replace(/\\/g, "\\\\").replace(/'/g, "'\\''")}'`;
}

export function zshDescribeItem(item: Pick<CompletionItem, "value" | "description">): string {
  const value = zshDescribePart(item.value);
  const description = item.description ? zshDescribePart(item.description) : "";
  return zshSingleQuotePreservingBackslash(`${value}:${description}`);
}

function zshDescribePart(value: string): string {
  return sanitizeLine(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function zshSingleQuotePreservingBackslash(value: string): string {
  return `'${sanitizeLine(value).replace(/'/g, "'\\''")}'`;
}

function sanitizeLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}
