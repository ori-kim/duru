import { OAUTH_RESERVED_PREFIXES } from "@duru/auth";
import { adaptResult, createCli, formatHelp, help, isHelpDocument, isValidationError } from "@duru/cli-kit";
import { env } from "@duru/env";
import { createDuruFileHome } from "@duru/file-store";
import { pluginManageCli } from "@duru/plugin-manage";
import { jsonRendererPlugin } from "@duru/renderer-json";
import { textRendererPlugin } from "@duru/renderer-text";
import { createSecretClient, loadManifest } from "@duru/secrets";
import { virtualPlugins } from "@duru/virtual-plugins";
import { createAppCompletionPlugin } from "./completion/index.ts";
import { createAppGateway } from "./gateway/index.ts";
import { outputFilter } from "./output-filter.ts";
import { updateCli } from "./routes/update/index.ts";
import { autoInjectDuruEnv } from "./secrets/auto-inject.ts";
import { createSecretCli } from "./secrets/commands.ts";
import { buildDefaultResolver } from "./secrets/default-resolver.ts";
import { manifestPath } from "./secrets/manifest-path.ts";
import { version } from "./version.ts";

export type AppCliOptions = {
  /** Skip auto-injection of DURU_* env vars from manifest. Tests use this. */
  skipAutoInject?: boolean;
};

export function createAppCli(opts: AppCliOptions = {}) {
  return {
    async run(
      argv?: readonly string[],
      options?: Parameters<Awaited<ReturnType<typeof createAppCliRuntime>>["run"]>[1],
    ) {
      return (await createAppCliRuntime(argv ? [...argv] : undefined, opts)).run(argv, options);
    },
  };
}

async function createAppCliRuntime(argv?: string[], opts: AppCliOptions = {}) {
  const fileHome = createDuruFileHome({ env: process.env });

  // Single manifest load + resolver build, shared by gateway + auto-inject + secret CLI.
  // Pass OAuth-reserved prefixes so manifest validation rejects user secrets named oauth/*.
  const manifestValidationOpts = { reservedPrefixes: OAUTH_RESERVED_PREFIXES };
  const manifest = await loadManifest(manifestPath(), manifestValidationOpts);
  const resolver = buildDefaultResolver();

  if (!opts.skipAutoInject) {
    const secretClient = createSecretClient(manifest, resolver);
    await autoInjectDuruEnv(secretClient);
  }

  const gateway = await createAppGateway({ env: process.env, manifest, resolver });

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
    .subCommand("plugin", pluginManageCli)
    .subCommand("secret", createSecretCli({ resolver, manifestValidation: manifestValidationOpts }))
    .use(createAppCompletionPlugin())
    .use(help())
    .use(virtualPlugins({ home: fileHome.root }, argv));

  cli.notFound((ctx) =>
    ctx.exit(1, { error: { message: `Unknown command: ${ctx.argv.join(" ")}` }, hint: "Run duru --help" }),
  );
  cli.catch((ctx) => {
    if (isValidationError(ctx.error)) return ctx.exit(2, ctx.error);
    return ctx.exit(1, { error: { message: errorMessage(ctx.error) } });
  });

  return cli;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
