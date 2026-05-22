import type { CommandFeature, CommandInputDefinition, EmptyObject } from "../types/index.ts";

export function input<TParams extends object = EmptyObject, TOptions extends object = EmptyObject>(
  definition: CommandInputDefinition<TParams, TOptions>,
): CommandFeature<TParams, TOptions> {
  return { kind: "commandInput", definition, ...(definition.metadata ? { metadata: definition.metadata } : {}) };
}

export function isCommandFeature(value: unknown): value is CommandFeature<object, object> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "commandInput" &&
    typeof (value as { definition?: unknown }).definition === "object" &&
    (value as { definition?: unknown }).definition !== null
  );
}
