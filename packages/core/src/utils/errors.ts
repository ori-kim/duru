const useColor = !process.env["NO_COLOR"] && process.stderr.isTTY;
const red = useColor ? "\x1b[31m" : "";
const reset = useColor ? "\x1b[0m" : "";

export class ClipError extends Error {
  constructor(message: string, readonly exitCode = 1) {
    super(message);
    this.name = "ClipError";
  }
}

export function die(message: string, exitCode = 1): never {
  throw new ClipError(message, exitCode);
}

export function printAndExit(e: unknown): never {
  if (e instanceof ClipError) {
    console.error(`${red}clip: ${e.message}${reset}`);
    process.exit(e.exitCode);
  }
  console.error(`${red}clip: ${String(e)}${reset}`);
  process.exit(1);
}
