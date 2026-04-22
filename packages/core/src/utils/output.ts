// ---------------------------------------------------------------------------
// Primitive types — 순환 의존 방지를 위해 extension.ts를 import하지 않고 직접 정의
// (extension.ts의 TargetResult, Tool과 구조적으로 동일)
// ---------------------------------------------------------------------------

export type TargetResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// ExecutionResult discriminated union
// ---------------------------------------------------------------------------

export interface ResultMeta {
  target: string;
  durationMs: number;
  format?: string;
}

export type ExecutionResult =
  | { kind: "tools";       tools: Tool[];                meta: ResultMeta }
  | { kind: "call-result"; content: unknown;             meta: ResultMeta }
  | { kind: "list";        items: unknown[];             meta: ResultMeta }
  | { kind: "help";        text: string;                 meta: ResultMeta }
  | { kind: "error";       error: Error; exitCode: number; meta: ResultMeta }
  | { kind: "stream";      stream: AsyncIterable<unknown>; meta: ResultMeta };

// ---------------------------------------------------------------------------
// OutputRenderer — view layer가 구현
// ---------------------------------------------------------------------------

export interface RenderOpts {
  format: string;
}

export interface OutputRenderer {
  formats: string[];
  canStream?: boolean;
  render(result: ExecutionResult, opts: RenderOpts): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// ResultPresenter — protocol/builtin extension이 등록
// ---------------------------------------------------------------------------

export interface ResultPresenter {
  /** 담당하는 target type */
  type: string;
  toViewModel(result: TargetResult, meta: ResultMeta): ExecutionResult;
}

// ---------------------------------------------------------------------------
// Legacy helper — TargetResult → plain/json 출력 (하위 호환 유지)
// OutputRegistry가 사용할 기본 동작을 아래에 구현한다.
// ---------------------------------------------------------------------------

export function renderPlain(result: TargetResult): number {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.stdout) {
    process.stdout.write(result.stdout);
    if (!result.stdout.endsWith("\n")) process.stdout.write("\n");
  }
  return result.exitCode;
}

export function renderJson(result: TargetResult): number {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  const text = result.stdout.trim();
  if (!text) return result.exitCode;
  try {
    const parsed = JSON.parse(text);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log(JSON.stringify({ output: text }, null, 2));
  }
  return result.exitCode;
}
