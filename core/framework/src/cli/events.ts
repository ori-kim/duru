import type { CliEventContext, CliEventName, CliEventRecord, Context } from "../types/index.ts";

export function createEventContext<TName extends CliEventName>(
  ctx: Context,
  event: CliEventRecord<TName>,
): CliEventContext<TName> {
  const payload = isRecord(event.payload) ? event.payload : {};
  return { ...ctx, event, ...payload } as unknown as CliEventContext<TName>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
