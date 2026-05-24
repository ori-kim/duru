import { createPlugin, parseOptionSpec, withRenderHint } from "@duru/cli-kit";
import type { CliPlugin } from "@duru/cli-kit";
import packageJson from "../package.json" with { type: "json" };

export const DURU_VERSION: string = resolveVersion();

export function version(): CliPlugin {
  return createPlugin((api) => {
    api.option(parseOptionSpec("-v, --version", "Show duru version"));
    api.middleware(async (ctx, next) => {
      if (!(ctx.options as { version?: boolean }).version) return next();
      if ((ctx.options as { json?: boolean }).json) return ctx.exit(0, { version: DURU_VERSION });
      return ctx.exit(0, withRenderHint({ text: `duru ${DURU_VERSION}` }, "text"));
    });
  });
}

function resolveVersion(): string {
  const envVersion = process.env.DURU_VERSION?.trim();
  if (envVersion) return envVersion;

  const fromGit = readGitVersion();
  if (fromGit) return fromGit;

  return packageJson.version;
}

function readGitVersion(): string | undefined {
  try {
    const proc = Bun.spawnSync({
      cmd: ["git", "-C", import.meta.dir, "describe", "--tags", "--always", "--dirty"],
      stdout: "pipe",
      stderr: "ignore",
    });
    if (proc.exitCode !== 0) return undefined;
    const text = new TextDecoder().decode(proc.stdout).trim();
    if (!text) return undefined;
    return text.replace(/^v/, "");
  } catch {
    return undefined;
  }
}
