import { createPlugin, parseOptionSpec, withRenderHint } from "@duru/cli-kit";
import type { CliPlugin } from "@duru/cli-kit";
import packageJson from "../package.json" with { type: "json" };

export const DURU_VERSION: string = packageJson.version;

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
