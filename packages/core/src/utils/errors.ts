const useColor = !process.env.NO_COLOR && process.stderr.isTTY;
const red = useColor ? "\x1b[31m" : "";
const reset = useColor ? "\x1b[0m" : "";

export class ClipError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ClipError";
  }
}

export function die(message: string, exitCode = 1, code?: string): never {
  throw new ClipError(message, exitCode, code);
}

function debugEnabled(): boolean {
  return process.env.CLIP_EXT_TRACE === "1" || process.env.CLIP_DEBUG === "1";
}

function errorCode(e: unknown): string {
  if (e instanceof ClipError && e.code) return e.code;
  if (e && typeof e === "object" && "code" in e && typeof e.code === "string") return e.code;
  return "CLIP_ERROR";
}

function errorMessage(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

export function printAndExit(e: unknown): never {
  if (e instanceof ClipError) {
    const prefix = e.code ? `${e.code}: ` : "";
    console.error(`${red}clip: ${prefix}${e.message}${reset}`);
    process.exit(e.exitCode);
  }
  if (debugEnabled()) {
    console.error(`${red}clip: ${e instanceof Error && e.stack ? e.stack : String(e)}${reset}`);
  } else {
    console.error(`${red}clip: ${errorCode(e)}: ${errorMessage(e)}${reset}`);
  }
  process.exit(1);
}
