import { type Cli, createCli } from "@duru/cli-kit";
import { registerManifestOps } from "./commands/manifest-ops.ts";
import { registerMigrateOps } from "./commands/migrate-ops.ts";
import type { SecretCliDeps } from "./commands/shared.ts";
import { GROUP } from "./commands/shared.ts";
import { registerValueOps } from "./commands/value-ops.ts";
import { registerVerifyOps } from "./commands/verify-ops.ts";

export type { SecretCliDeps } from "./commands/shared.ts";

export function createSecretCli(deps: SecretCliDeps): Cli {
  const cli = createCli();

  cli.command().meta({ description: "Manage duru secrets manifest" }).group(GROUP);

  registerManifestOps(cli, deps);
  registerValueOps(cli, deps);
  registerVerifyOps(cli, deps);
  registerMigrateOps(cli, deps);

  return cli;
}
