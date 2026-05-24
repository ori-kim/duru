import { adaptResult, createCli, formatHelp, help, isHelpDocument, isValidationError } from "@duru/cli-kit";
import { env } from "@duru/env";
import { createDuruFileHome } from "@duru/file-store";
import { pluginManageCli } from "@duru/plugin-manage";
import { jsonRendererPlugin } from "@duru/renderer-json";
import { textRendererPlugin } from "@duru/renderer-text";
import { virtualPlugins } from "@duru/virtual-plugins";
import { createAppCompletionPlugin } from "./completion/index.ts";
import { createAppGateway } from "./gateway/index.ts";
import { outputFilter } from "./output-filter.ts";
import { chatCli } from "./routes/chat/index.ts";
import { updateCli } from "./routes/update/index.ts";
import { version } from "./version.ts";

export function createAppCli() {
  return {
    async run(
      argv?: readonly string[],
      options?: Parameters<Awaited<ReturnType<typeof createAppCliRuntime>>["run"]>[1],
    ) {
      return (await createAppCliRuntime(argv ? [...argv] : undefined)).run(argv, options);
    },
  };
}

async function createAppCliRuntime(argv?: string[]) {
  const fileHome = createDuruFileHome({ env: process.env });
  const gateway = await createAppGateway({ env: process.env });

  const cli = createCli({ name: "duru" })
    .use(adaptResult({ when: (ctx) => !ctx.options.json, match: isHelpDocument, adapt: formatHelp }))
    .use(textRendererPlugin())
    .use(jsonRendererPlugin())
    .use(outputFilter())
    .use(version())
    .use(env())
    .use(gateway.plugin)
    .subCommand(gateway.routeName, gateway.cli)
    .subCommand("update", updateCli)
    .subCommand("chat", chatCli)
    .subCommand("plugin", pluginManageCli)
    .use(createAppCompletionPlugin())
    .use(help())
    .use(virtualPlugins({ home: fileHome.root }, argv));

  cli.notFound((ctx) => ctx.exit(1, { error: { message: `Unknown command: ${ctx.argv.join(" ")}` }, hint: "Run duru --help" }));
  cli.catch((ctx) => {
    if (isValidationError(ctx.error)) return ctx.exit(2, ctx.error);
    return ctx.exit(1, { error: { message: errorMessage(ctx.error) } });
  });

  return cli;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
