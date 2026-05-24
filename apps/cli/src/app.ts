import { adaptResult, createCli, formatHelp, help, isHelpDocument, isValidationError } from "@duru/cli-kit";
import { env } from "@duru/env";
import { createDuruFileHome } from "@duru/file-store";
import { contextModePlugin, createContextStore } from "@duru/plugin-context-mode";
import { jsonRendererPlugin } from "@duru/renderer-json";
import { textRendererPlugin } from "@duru/renderer-text";
import { readAppConfig } from "./config.ts";
import { createAppCompletionPlugin } from "./completion/index.ts";
import { createAppGateway } from "./gateway/index.ts";
import { updateCli } from "./routes/update/index.ts";

export function createAppCli() {
  return {
    async run(
      argv?: readonly string[],
      options?: Parameters<Awaited<ReturnType<typeof createAppCliRuntime>>["run"]>[1],
    ) {
      return (await createAppCliRuntime()).run(argv, options);
    },
  };
}

async function createAppCliRuntime() {
  const fileHome = createDuruFileHome({ env: process.env });
  const appConfig = await readAppConfig(fileHome.store());
  const contextStore = createContextStore(fileHome.scope("context"));

  const gateway = await createAppGateway({ env: process.env });
  const cli = createCli({
    name: "duru",
  })
    .option("--context-mode", "Capture this invocation to context history")
    .use(
      adaptResult({
        when: (ctx) => !ctx.options.json,
        match: isHelpDocument,
        adapt: formatHelp,
      }),
    )
    .use(textRendererPlugin())
    .use(jsonRendererPlugin())
    .use(env())
    .use(async (ctx, next) => {
      const cmd = ctx.request.argv[0];
      const isContextCmd = cmd === "context" || cmd === "ctx";
      if (isContextCmd) return next();

      const enabled =
        Boolean(ctx.options.contextMode) ||
        (appConfig.contextMode?.commands?.includes(cmd ?? "") ?? false);

      if (!enabled) return next();

      const at = new Date().toISOString();
      try {
        const result = await next();
        await contextStore.append({ at, argv: ctx.request.argv, status: "ok" });
        return result;
      } catch (err) {
        await contextStore.append({
          at,
          argv: ctx.request.argv,
          status: "error",
          text: errorMessage(err),
        });
        throw err;
      }
    })
    .use(gateway.plugin)
    .subCommand(gateway.routeName, gateway.cli)
    .subCommand("update", updateCli)
    .use(createAppCompletionPlugin())
    .use(help());

  await contextModePlugin(contextStore).install(cli);

  cli.notFound((ctx) => {
    return ctx.exit(1, {
      error: { message: `Unknown command: ${ctx.argv.join(" ")}` },
      hint: "Run duru --help",
    });
  });
  cli.catch((ctx) => {
    if (isValidationError(ctx.error)) return ctx.exit(2, ctx.error);
    return ctx.exit(1, {
      error: { message: errorMessage(ctx.error) },
    });
  });

  return cli;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
