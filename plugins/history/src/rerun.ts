import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export type RerunOptions = {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
};

function resolveEntry(): { exec: string; prefix: readonly string[] } {
  const argv0 = process.argv[0] ?? "duru";
  const argv1 = process.argv[1];
  if (argv1 && /\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(argv1)) {
    return { exec: argv0, prefix: [resolve(argv1)] };
  }
  return { exec: argv1 ?? argv0, prefix: [] };
}

export function rerun(argv: readonly string[], options: RerunOptions = {}): number {
  const { exec, prefix } = resolveEntry();
  const result = spawnSync(exec, [...prefix, ...argv], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}
