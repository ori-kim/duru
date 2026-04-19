import { HELP, VERSION } from "./help.ts";

export function parseGlobalFlags(argv: string[]): {
  jsonMode: boolean;
  pipeMode: boolean;
  dryRun: boolean;
  configPath: string | undefined;
  rest: string[];
} {
  let jsonMode = false;
  let pipeMode = false;
  let dryRun = false;
  let configPath: string | undefined;
  let i = 0;

  while (i < argv.length) {
    const a = argv[i] ?? "";
    if (a === "--json") {
      jsonMode = true;
      i++;
    } else if (a === "--pipe") {
      pipeMode = true;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
      i++;
    } else if (a === "--debug") {
      process.env["CLIP_EXT_TRACE"] = "1";
      i++;
    } else if (a === "--help" || a === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (a === "--version" || a === "-v") {
      console.log(`clip ${VERSION}`);
      process.exit(0);
    } else if ((a === "--config" || a === "-c") && argv[i + 1]) {
      configPath = argv[++i];
      i++;
    } else {
      break;
    }
  }

  return { jsonMode, pipeMode, dryRun, configPath, rest: argv.slice(i) };
}
