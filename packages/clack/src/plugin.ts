import * as p from "@clack/prompts";
import { createPlugin, parseOptionSpec } from "@duru/cli-kit";
import type { CliPlugin } from "@duru/cli-kit";
import { clackRenderer } from "@duru/renderer-clack";
import { CLACK_INPUT_SERVICE_KEY, createClackInput } from "./prompt.ts";
import { box } from "./sugar.ts";

export type ClackPluginOptions = {
  detectCI?: boolean;
  theme?: Parameters<typeof p.updateSettings>[0];
  errorBox?: boolean;
};

const GLOBAL_YES_OPTION = parseOptionSpec("-y, --yes", "비대화식 실행 (모든 confirm 자동 통과)");

export function clackPlugin(options: ClackPluginOptions = {}): CliPlugin {
  if (options.theme) p.updateSettings(options.theme);

  return createPlugin((api) => {
    api.renderer(clackRenderer());
    api.defaultRenderer("clack");

    api.option(GLOBAL_YES_OPTION);

    if (options.detectCI) {
      api.optionFallback(({ option }) => {
        if (option.name !== "yes") return undefined;
        return p.isCI() ? true : undefined;
      });
    }

    api.middleware(async (ctx, next) => {
      ctx.setService(CLACK_INPUT_SERVICE_KEY, createClackInput());
      return next();
    });

    if (options.errorBox) {
      api.cli.catch((ctx) => {
        const message = ctx.error instanceof Error ? ctx.error.message : String(ctx.error);
        box(message, "Error", { rounded: true });
        return ctx.exit(1, null);
      });
    }
  });
}
