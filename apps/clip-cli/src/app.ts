import { createCli, createRouter, renderer } from "@clip/core";
import { jsonRenderer } from "@clip/renderer-json";
import { textRenderer } from "@clip/renderer-text";

export function createAppCli() {
  const cli = createCli({
    name: "clip",
  }).use(renderer(jsonRenderer(), textRenderer()));

  cli.command("inspect", "Show framework composition").action(() => {
    return {
      app: "clip-cli",
      core: "@clip/core",
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

  const registry = createRouter({
    name: "registry",
    description: "Manage registries",
  });

  registry.command("add <name>", "Add registry").action((ctx) => {
    return { registry: ctx.params.name, status: "added" };
  });

  const ext = createRouter({
    name: "ext",
    description: "Manage extensions",
  }).use(registry);

  ext.command("add <name>", "Add extension").action((ctx) => {
    return { extension: ctx.params.name, status: "added" };
  });

  cli.use(ext);

  return cli;
}
