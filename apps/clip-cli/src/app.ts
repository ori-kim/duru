import { cliGateway, defaultGatewayAdapters } from "@clip/cli-gateway";
import { env } from "@clip/env";
import { createClipFileHome } from "@clip/file-store";
import { input } from "@clip/input-validation";
import { adaptResult, context, createCli, formatHelp, help, isHelpDocument, isValidationError, meta } from "@clip/kit";
import { jsonRendererPlugin } from "@clip/renderer-json";
import { textRendererPlugin } from "@clip/renderer-text";
import { z } from "zod";
import { createAppGatewayStore } from "./gateway-store.ts";

export function createAppCli() {
  const fileHome = createClipFileHome({ env: process.env });
  const gatewayStore = createAppGatewayStore({ files: fileHome.store("target") });
  const cli = createCli({
    name: "clip",
  })
    .use(context<{ lastLog: string }>())
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
    .use(cliGateway({ store: gatewayStore, adapters: defaultGatewayAdapters() }))
    .use(help());

  cli.on("log", (ctx) => {
    const payload = ctx.event.payload as { message?: string };
    ctx.set("lastLog", payload.message ?? "log");
  });
  cli.on("help", async (ctx) => {
    await ctx.emit("log", {
      message: "help requested",
      path: ctx.document.path.join(" ") || "root",
    });
  });
  cli.notFound((ctx) => {
    return ctx.exit(1, {
      error: { message: `Unknown command: ${ctx.argv.join(" ")}` },
      hint: "Run clip --help",
    });
  });
  cli.catch((ctx) => {
    if (isValidationError(ctx.error)) return ctx.exit(2, ctx.error);
    return ctx.exit(1, {
      error: { message: errorMessage(ctx.error) },
      hint: "The catch handler converted this failure",
    });
  });

  cli
    .command(
      "call",
      input({
        params: z.object({
          operation: z.coerce.number().min(1),
        }),
        options: z.object({
          timeoutMs: z.coerce.number().int().positive().default(30000),
          dryRun: z.boolean().default(false),
        }),
      }),
      meta({
        description: "Run a typed command input demo",
        examples: ["clip call sync --timeout-ms 1500 --dry-run"],
        group: "Examples",
      }),
    )
    .action((ctx) => {
      return {
        operation: ctx.params.operation,
        timeoutMs: ctx.options.timeoutMs,
        dryRun: ctx.options.dryRun,
      };
    })
    .text((result) => `${result.operation} timeout=${result.timeoutMs} dryRun=${result.dryRun}`)
    .json((result) => result);

  cli.command("inspect", "Show framework composition").action(() => {
    return {
      app: "clip-cli",
      core: "@clip/kit",
      renderers: ["text", "json"],
    };
  });

  cli
    .command("hello <name>", "Run a framework demo command")
    .option("-u, --uppercase", "Uppercase the greeting")
    .action((ctx) => {
      const value = ctx.params.name;
      return { greeting: `hello ${ctx.options.uppercase ? value.toUpperCase() : value}` };
    })
    .text((result) => result.greeting)
    .json((result) => result);

  const metadataApp = createCli();

  metadataApp
    .command(
      "publish <name>",
      meta({
        description: "Run command metadata demo",
        aliases: ["pub <name>"],
        examples: ["clip metadata publish notes", "clip meta pub notes --dry-run"],
        usage: "publish <name> [--dry-run]",
        group: "Examples",
      }),
    )
    .option("--dry-run", "Preview the publish operation")
    .action((ctx) => ({ name: ctx.params.name, status: "published", dryRun: ctx.options.dryRun ?? false }));

  cli.route("metadata", metadataApp);
  cli.route("meta", metadataApp);

  cli.command("events", "Run event observer demo").action(async (ctx) => {
    await ctx.emit("log", { message: "event observer ran" });
    return { observed: ctx.var.lastLog };
  });

  cli.command("fail", "Run catch handler demo").action(() => {
    throw new Error("demo failure");
  });

  const optionsApp = createCli();

  optionsApp
    .command("request <resource>", "Run rich option schema demo")
    .option("--method <method>", "HTTP method")
    .option("--retry <count>", "Retry count")
    .option("--tag <tag>", "Attach a tag")
    .option("--token <token>", "Example service token")
    .option("--fast", "Use the fast path")
    .option("--safe", "Use the safe path")
    .option("--trace", "Include trace output")
    .option("--verbose", "Enable verbose output")
    .action((ctx) => {
      return {
        resource: ctx.params.resource,
        method: ctx.options.method,
        retry: ctx.options.retry,
        tags: ctx.options.tag,
        token: ctx.options.token,
      };
    });

  cli.route("options", optionsApp);

  const registry = createCli();

  registry.command("add <name>", "Add registry").action((ctx) => {
    return { registry: ctx.params.name, status: "added" };
  });

  const ext = createCli().route("registry", registry);

  ext.command("add <name>", "Add extension").action((ctx) => {
    return { extension: ctx.params.name, status: "added" };
  });

  cli.route("ext", ext);

  const tools = createCli().catch((ctx) => {
    return ctx.exit(4, { handledBy: "tools", message: errorMessage(ctx.error) });
  });

  tools.command("echo <value>", "Echo a value").action((ctx) => {
    return { value: ctx.params.value };
  });
  tools.command("fail", "Run route error boundary demo").action(() => {
    throw new Error("tool failure");
  });
  tools
    .command("recover", "Run command error boundary demo")
    .catch((ctx) => {
      return ctx.exit(3, { handledBy: "command", message: errorMessage(ctx.error) });
    })
    .action(() => {
      throw new Error("recoverable failure");
    });

  cli.use("tools", async (ctx, next) => {
    await ctx.emit("log", {
      message: "tools subtree",
      path: ctx.request.argv.join(" "),
    });
    return next();
  });
  cli.route("tools", tools);

  return cli;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
