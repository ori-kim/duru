export type CaptureRecord = {
  id: string;
  at: string;
  argv: readonly string[];
  status: "ok" | "error";
  text?: string;
};

export type ContextState = {
  nextId: number;
  captures: readonly CaptureRecord[];
};
