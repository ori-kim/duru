import * as p from "@clack/prompts";

export * from "@duru/renderer-clack/sugar";

export type IntroOptions = { title?: string };
export function intro(title?: string): void {
  p.intro(title);
}

export type OutroOptions = { message?: string };
export function outro(message?: string): void {
  p.outro(message);
}

export type CancelOptions = { message?: string };
export function cancel(message?: string): void {
  p.cancel(message);
}

export type BoxAlignment = "left" | "center" | "right";
export type BoxOptions = {
  contentAlign?: BoxAlignment;
  titleAlign?: BoxAlignment;
  width?: number | "auto";
  titlePadding?: number;
  contentPadding?: number;
  rounded?: boolean;
  formatBorder?: (text: string) => string;
};
export function box(message?: string, title?: string, opts?: BoxOptions): void {
  p.box(message, title, opts);
}

export type StreamLevel = "message" | "info" | "success" | "step" | "warn" | "error";
export async function stream(
  iterable: Iterable<string> | AsyncIterable<string>,
  level: StreamLevel = "message",
): Promise<void> {
  if (level === "message") return p.stream.message(iterable);
  if (level === "info") return p.stream.info(iterable);
  if (level === "success") return p.stream.success(iterable);
  if (level === "step") return p.stream.step(iterable);
  if (level === "warn") return p.stream.warn(iterable);
  if (level === "error") return p.stream.error(iterable);
}

export type Task = {
  title: string;
  task: (setMessage: (msg: string) => void) => string | Promise<string> | void | Promise<void>;
  enabled?: boolean;
};
export async function tasks(items: Task[]): Promise<void> {
  await p.tasks(items.map((item) => ({ ...item })));
}

export type TaskLogOptions = {
  title: string;
  limit?: number;
  spacing?: number;
  retainLog?: boolean;
};
export type TaskLogHandle = ReturnType<typeof p.taskLog>;
export function taskLog(opts: TaskLogOptions): TaskLogHandle {
  return p.taskLog(opts);
}
