#!/usr/bin/env bun
import { createAppCli } from "./app.ts";

if (import.meta.main) {
  const result = await createAppCli().run(Bun.argv.slice(2));
  if (result.rendered?.stdout) process.stdout.write(result.rendered.stdout);
  if (result.rendered?.stderr) process.stderr.write(result.rendered.stderr);
  process.exitCode = result.exitCode;
}
