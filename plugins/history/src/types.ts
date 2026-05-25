export type HistoryStatus = "ok" | "error" | "cancelled";

export type HistoryRecord = {
  readonly id: string;
  readonly at: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly status: HistoryStatus;
  readonly exitCode: number;
  readonly durationMs: number;
};

export type HistoryListOptions = {
  readonly limit?: number;
  readonly since?: string;
  readonly grep?: string;
  readonly errorsOnly?: boolean;
};

export type HistoryIgnoreConfig = {
  readonly ignore?: readonly string[];
};
