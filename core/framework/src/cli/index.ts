import { createContext, createEmptyContext } from "../context/index.ts";
import { runPipeline } from "../middleware/pipeline.ts";
import { parseOptions } from "../options/index.ts";
import { isCliPlugin, option as optionPlugin } from "../plugin/index.ts";
import { createRouter } from "../router/index.ts";
import type {
  Cli,
  CliOptions,
  CliPlugin,
  CliRunOptions,
  CliRunResult,
  Context,
  EmptyObject,
  Middleware,
  OptionDefinition,
  Options,
  Output,
  Renderer,
} from "../types/index.ts";

export function createCli<TGlobalOptions extends Options = EmptyObject>(
  options: CliOptions<TGlobalOptions> = {},
): Cli<TGlobalOptions> {
  const globalOptions: OptionDefinition[] = [];
  const middleware: Middleware[] = [];
  const renderers = new Map<string, Renderer>();
  const rendererSelectors: Array<(ctx: Context) => string | undefined> = [];
  const usageProviders: Array<(name: string) => string> = [];
  const services = new Map<string, unknown>();
  const defaultRouter = createRouter<TGlobalOptions>();
  let defaultRenderer = "text";

  const cli: Cli<TGlobalOptions> = {
    option(spec, description) {
      return cli.use(optionPlugin(spec, description)) as never;
    },
    use(item: CliPlugin<Options> | Middleware<TGlobalOptions>) {
      if (isCliPlugin(item)) {
        item.install(pluginApi());
        return cli as never;
      }
      middleware.push(item as Middleware);
      return cli;
    },
    renderer(renderer) {
      pluginApi().renderer(renderer);
      pluginApi().defaultRenderer(renderer.id);
      return cli;
    },
    command<TPattern extends string>(pattern: TPattern, description?: string) {
      return defaultRouter.command(pattern, description);
    },
    run(argv = [], runOptions = {}) {
      return runCli(argv, runOptions);
    },
  };

  return cli;

  function pluginApi() {
    return {
      option(definition: OptionDefinition) {
        globalOptions.push(definition);
      },
      options() {
        return [...globalOptions];
      },
      middleware(fn: Middleware) {
        middleware.push(fn);
      },
      renderer(renderer: Renderer) {
        renderers.set(renderer.id, renderer);
      },
      defaultRenderer(id: string) {
        defaultRenderer = id;
      },
      selectRenderer(selector: (ctx: Context) => string | undefined) {
        rendererSelectors.push(selector);
      },
      usage(provider: (name: string) => string) {
        usageProviders.push(provider);
      },
    };
  }

  async function runCli(argv: readonly string[], runOptions: CliRunOptions): Promise<CliRunResult> {
    if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
      return renderResult(helpResult(argv), runOptions);
    }

    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals, services);
    await runPipeline([...middleware, defaultRouter.middleware(() => globalOptions)], ctx, async () => undefined);
    const handled = ctx.state.get("handled") === true;
    const outputs = handled
      ? ctx.output.list()
      : [{ kind: "text" as const, text: `Unknown command: ${argv.join(" ")}` }];
    return renderResult({ ok: handled, exitCode: handled ? 0 : 1, outputs, ctx }, runOptions);
  }

  async function renderResult(
    result: {
      ok: boolean;
      exitCode: number;
      outputs: readonly Output[];
      ctx?: Context;
    },
    runOptions: CliRunOptions,
  ): Promise<CliRunResult> {
    const shouldRender = runOptions.render ?? true;
    if (!shouldRender) return { ok: result.ok, exitCode: result.exitCode, outputs: result.outputs };
    const ctx = result.ctx ?? createEmptyContext(argvFromOutputs(result.outputs));
    const rendererId = runOptions.renderer ?? selectRenderer(ctx) ?? defaultRenderer;
    const renderer = renderers.get(rendererId);
    if (!renderer) return { ok: result.ok, exitCode: result.exitCode, outputs: result.outputs };
    const rendered = await renderer.render(result.outputs, ctx);
    return { ok: result.ok, exitCode: rendered.exitCode, outputs: result.outputs, rendered };
  }

  function helpResult(argv: readonly string[]) {
    const parsed = parseOptions(argv, globalOptions);
    const ctx = createContext(argv, parsed.options, parsed.positionals, services);
    return {
      ok: true,
      exitCode: 0,
      outputs: [{ kind: "text" as const, text: usageText(options.name ?? "cli") }],
      ctx,
    };
  }

  function selectRenderer(ctx: Context) {
    for (const selector of rendererSelectors) {
      const id = selector(ctx);
      if (id) return id;
    }
    return undefined;
  }

  function usageText(name: string) {
    const sections = [defaultRouter.usage(name), ...usageProviders.map((provider) => provider(name))];
    const commands = sections.flatMap(commandLines);
    const text = [`Usage: ${name} <command>`, "", "Commands:", ...commands].join("\n").trimEnd();
    return `${text}\n`;
  }
}

function argvFromOutputs(_outputs: readonly unknown[]): readonly string[] {
  return [];
}

function commandLines(usage: string): string[] {
  const lines = usage.split("\n");
  const commandsIndex = lines.findIndex((line) => line.trim() === "Commands:");
  const linesAfterHeader = commandsIndex === -1 ? lines : lines.slice(commandsIndex + 1);
  return linesAfterHeader.filter((line) => line.trim().length > 0);
}
