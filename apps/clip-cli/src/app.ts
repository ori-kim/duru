import { createCli, createRouter, renderer } from "@clip/core";
import { jsonRenderer } from "@clip/renderer-json";
import { textRenderer } from "@clip/renderer-text";

export function createAppCli() {
  const cli = createCli({
    name: "clip",
  }).use(renderer(jsonRenderer(), textRenderer()));

  cli
    .command("hello <name>", "Run a framework demo command")
    .option("-u, --uppercase", "Uppercase the greeting")
    .action((name, options) => {
      const value = String(name);
      return { greeting: `hello ${options.uppercase ? value.toUpperCase() : value}` };
    })
    .render((result) => result.greeting);

  cli.command("inspect", "Show framework composition").action(() => {
    return {
      app: "clip-cli",
      core: "@clip/core",
      renderers: ["text", "json"],
    };
  });

  const registry = createRouter({
    name: "registry",
    description: "Manage registries",
  });

  registry.command("add <name>", "Add registry").action((name) => {
    return { registry: name, status: "added" };
  });

  const ext = createRouter({
    name: "ext",
    description: "Manage extensions",
  }).use(registry);

  ext.command("add <name>", "Add extension").action((name) => {
    return { extension: name, status: "added" };
  });

  cli.use(ext);

  return cli;
}
