import type { Cli } from "@duru/cli-kit";
import { loadManifest, parseReference } from "@duru/secrets";
import { manifestPath } from "../manifest-path.ts";
import {
  GROUP,
  type SecretCliDeps,
  errorMessage,
  maskValue,
  notFoundMessage,
  pollUntilSet,
  promptSecret,
} from "./shared.ts";

export function registerValueOps(cli: Cli, deps: SecretCliDeps): void {
  registerSet(cli, deps);
  registerGet(cli, deps);
  registerUnset(cli, deps);
}

function registerSet(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("set <name>")
    .meta({ description: "Set the backend value for a manifest secret" })
    .group(GROUP)
    .option("--value <value>", "Provide value non-interactively (shell history risk)")
    .option("--inline", "Skip provider native UI; prompt in terminal")
    .option("--no-wait", "Open native UI but don't poll for value")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const ref = m.data.secrets[name];
      if (!ref) {
        return ctx.exit(1, {
          error: { message: `Secret "${name}" not in manifest. Run \`duru secret add\` first.` },
        });
      }

      const { resolver } = deps;

      if (typeof ctx.options.value === "string") {
        await resolver.store(ref, ctx.options.value);
        return ctx.exit(0, { name, ref, stored: true });
      }

      const parsed = parseReference(ref);
      const provider = resolver.providerFor(ref);
      const inline = Boolean(ctx.options.inline) || !process.stdout.isTTY;

      if (!inline && provider.openForSet) {
        const inst = await provider.openForSet(parsed.path);
        process.stdout.write(`Opening ${inst.opened}...\n\nSteps:\n`);
        for (const [i, step] of inst.steps.entries()) {
          process.stdout.write(`  ${i + 1}. ${step}\n`);
        }
        process.stdout.write("\n");

        const shouldWait = ctx.options.wait !== false;
        if (!shouldWait || !inst.verify) {
          return ctx.exit(0, { name, ref, opened: inst.opened, waiting: false });
        }

        try {
          await pollUntilSet(resolver, ref, inst.verify);
          return ctx.exit(0, { name, ref, opened: inst.opened, detected: true });
        } catch (err) {
          return ctx.exit(1, { error: { message: errorMessage(err) } });
        }
      }

      const value = await promptSecret(`Value for ${name}`);
      if (value === undefined) return ctx.exit(1, { error: { message: "Cancelled" } });
      await resolver.store(ref, value);
      return ctx.exit(0, { name, ref, stored: true });
    });
}

function registerGet(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("get <name>")
    .meta({ description: "Get the backend value for a manifest secret (masked by default)" })
    .group(GROUP)
    .option("--reveal", "Output the value in plaintext (requires TTY, not --json)")
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const ref = m.data.secrets[name];
      if (!ref) return ctx.exit(1, { error: { message: notFoundMessage(name) } });
      const value = await deps.resolver.resolve(ref);
      if (value === undefined) {
        return ctx.exit(1, {
          error: {
            message: `No backend value stored for "${name}". Run \`duru secret set ${name}\` to store one.`,
          },
        });
      }
      const revealAsked = Boolean(ctx.options.reveal);
      if (revealAsked && (ctx.options as { json?: boolean }).json) {
        return ctx.exit(1, {
          error: {
            message:
              "--reveal cannot be combined with --json (plaintext would land in machine-readable output). Use --reveal alone for human-readable output.",
          },
        });
      }
      if (revealAsked && !process.stdout.isTTY) {
        return ctx.exit(1, {
          error: {
            message: "--reveal requires a TTY (refusing to write plaintext to a non-terminal stdout).",
          },
        });
      }
      return ctx.exit(0, { name, ref, value: revealAsked ? value : maskValue(value) });
    });
}

function registerUnset(cli: Cli, deps: SecretCliDeps): void {
  cli
    .command("unset <name>")
    .meta({ description: "Remove backend value (manifest entry kept)" })
    .group(GROUP)
    .action(async (ctx) => {
      const name = ctx.params.name as string;
      const m = await loadManifest(manifestPath(), deps.manifestValidation);
      const ref = m.data.secrets[name];
      if (!ref) return ctx.exit(1, { error: { message: notFoundMessage(name) } });
      try {
        await deps.resolver.remove(ref);
      } catch (err) {
        return ctx.exit(1, { error: { message: errorMessage(err) } });
      }
      return ctx.exit(0, { name, ref, unset: true });
    });
}
