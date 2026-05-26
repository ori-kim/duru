export interface SecretProvider {
  readonly scheme: string;
  get(path: string): Promise<string | undefined>;
  set(path: string, value: string): Promise<void>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  openForSet?(path: string): Promise<SetInstructions>;
}

export interface SetInstructions {
  opened: string;
  steps: string[];
  verify?: {
    method: "poll";
    intervalMs: number;
    timeoutMs: number;
  };
}
