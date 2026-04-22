import { die } from "@clip/core";
import type { ExecutorContext, TargetResult } from "@clip/core";
import type { CliTarget } from "./schema.ts";

function shellQuote(arg: string): string {
  if (/^[a-zA-Z0-9._\-/:=@,+]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export async function executeCli(target: CliTarget, ctx: ExecutorContext): Promise<TargetResult> {
  const { subcommand, args, dryRun, passthrough } = ctx;
  const cmd = [target.command, ...(target.args ?? []), subcommand, ...args];

  if (dryRun) {
    return { exitCode: 0, stdout: `${cmd.map(shellQuote).join(" ")}\n`, stderr: "" };
  }
  const env = { ...process.env, ...(target.env ?? {}) } as Record<string, string>;

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    if (passthrough) {
      proc = Bun.spawn(cmd, { stdin: "inherit", stdout: "inherit", stderr: "inherit", env });
      const exitCode = await proc.exited;
      return { exitCode, stdout: "", stderr: "" };
    }

    proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env });
  } catch {
    die(`Command not found: ${target.command}`, 127);
  }

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout as ReadableStream<Uint8Array>).text();
  const stderr = await new Response(proc.stderr as ReadableStream<Uint8Array>).text();

  return { exitCode, stdout, stderr };
}
