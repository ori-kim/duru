import { createCli, renderer } from "@clip/core";
import { jsonRenderer } from "@clip/renderer-json";
import { textRenderer } from "@clip/renderer-text";

export function createAppCli() {
  const cli = createCli({
    name: "clip",
  }).use(renderer(jsonRenderer(), textRenderer()));

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
