const TAG = Symbol.for("duru.render");

export function withRenderHint<T extends object>(value: T, hint: string): T {
  Object.defineProperty(value, TAG, { value: hint, enumerable: false, configurable: true, writable: true });
  return value;
}

export function getRenderHint(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const hint = (value as Record<symbol, unknown>)[TAG];
  return typeof hint === "string" ? hint : undefined;
}
