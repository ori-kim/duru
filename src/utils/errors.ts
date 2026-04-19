const useColor = !process.env["NO_COLOR"] && process.stderr.isTTY;
const red = useColor ? "\x1b[31m" : "";
const reset = useColor ? "\x1b[0m" : "";

export function die(message: string, exitCode = 1): never {
  console.error(`${red}clip: ${message}${reset}`);
  process.exit(exitCode);
}
