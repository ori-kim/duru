import { spawn } from "node:child_process";

const NOT_FOUND_CODE = 44;

class SecurityCommandError extends Error {
  constructor(
    public readonly code: number,
    public readonly stderr: string,
  ) {
    super(`security exited with ${code}: ${stderr.trim()}`);
  }
}

type RunResult = { stdout: string; stderr: string; code: number };

function runSecurity(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn("security", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      const c = code ?? -1;
      if (c === 0) resolve({ stdout, stderr, code: c });
      else reject(new SecurityCommandError(c, stderr));
    });
  });
}

function isNotFound(err: unknown): boolean {
  return err instanceof SecurityCommandError && err.code === NOT_FOUND_CODE;
}

export async function addGenericPassword(service: string, account: string, password: string): Promise<void> {
  // -U: update if exists. -w: password value (last arg).
  await runSecurity(["add-generic-password", "-U", "-s", service, "-a", account, "-w", password]);
}

export async function findGenericPassword(service: string, account: string): Promise<string | undefined> {
  try {
    const result = await runSecurity(["find-generic-password", "-s", service, "-a", account, "-w"]);
    return result.stdout.replace(/\n$/, "");
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

export async function deleteGenericPassword(service: string, account: string): Promise<void> {
  try {
    await runSecurity(["delete-generic-password", "-s", service, "-a", account]);
  } catch (err) {
    if (isNotFound(err)) return;
    throw err;
  }
}
