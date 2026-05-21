export type Output =
  | { kind: "text"; text: string }
  | { kind: "data"; value: unknown }
  | { kind: "table"; rows: readonly Record<string, unknown>[] }
  | { kind: "log"; stream: "stdout" | "stderr"; text: string }
  | { kind: "task"; title: string; status: "running" | "done" | "failed"; message?: string }
  | { kind: "view"; value: unknown };

export type RenderedOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type OutputWriter = {
  emit(output: Output): void;
  text(text: string): void;
  data(value: unknown): void;
  table(rows: readonly Record<string, unknown>[]): void;
  log(text: string, stream?: "stdout" | "stderr"): void;
  task(title: string, status: "running" | "done" | "failed", message?: string): void;
  view(value: unknown): void;
  list(): readonly Output[];
};

export type ActionResult = unknown;
