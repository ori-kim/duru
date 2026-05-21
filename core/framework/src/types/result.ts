export type ExitResult<TValue = unknown> = {
  readonly kind: "clip.exit";
  ok: boolean;
  exitCode: number;
  result: TValue;
};
