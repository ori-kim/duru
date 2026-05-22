import type { CliEventRecord } from "./event.ts";

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

export type RenderInput = {
  result: unknown;
  value: unknown;
  events: readonly CliEventRecord[];
  format: string;
};

export type ActionResult = unknown;
