import { createCli } from "@clip/core";
import { jsonRenderer } from "@clip/renderer-json";
import { textRenderer } from "@clip/renderer-text";

export function createAppCli() {
  const cli = createCli<{ json?: boolean }>({
    name: "clip",
    defaultRenderer: "text",
    selectRenderer(ctx) {
      return ctx.options.json ? "json" : "text";
    },
  });

  cli.option("--json", "Render structured JSON output");
  cli.renderer(textRenderer());
  cli.renderer(jsonRenderer());

  cli
    .command("hello <name>", "Run a framework demo command")
    .option("-u, --uppercase", "Uppercase the greeting")
    .action((name, options, ctx) => {
      const value = String(name);
      const greeting = `hello ${options.uppercase ? value.toUpperCase() : value}`;
      ctx.output.text(greeting);
      return undefined;
    });

  cli.command("inspect", "Show framework composition").action((_options, ctx) => {
    ctx.output.data({
      app: "clip-cli",
      core: "@clip/core",
      renderers: ["text", "json"],
    });
    return undefined;
  });

  return cli;
}
