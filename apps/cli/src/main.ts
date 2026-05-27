#!/usr/bin/env bun
import { createSecretClient, loadManifest } from "@duru/secrets";
import { createAppCli } from "./app.ts";
import { autoInjectDuruEnv } from "./secrets/auto-inject.ts";
import { buildDefaultResolver } from "./secrets/default-resolver.ts";
import { manifestPath } from "./secrets/manifest-path.ts";

if (import.meta.main) {
  // Auto-inject DURU_* secrets before CLI starts so plugins/subprocess see them.
  try {
    const manifest = await loadManifest(manifestPath());
    const resolver = buildDefaultResolver();
    const client = createSecretClient(manifest, resolver);
    await autoInjectDuruEnv(client);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`warning: secret auto-inject skipped: ${message}\n`);
  }

  const result = await createAppCli().run(Bun.argv.slice(2));
  if (result.rendered?.stdout) process.stdout.write(result.rendered.stdout);
  if (result.rendered?.stderr) process.stderr.write(result.rendered.stderr);
  process.exitCode = result.exitCode;
}
