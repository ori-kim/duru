import { getTarget, loadConfig } from "@clip/core";
import { dispatch } from "@clip/core";
import type { Registry } from "@clip/core";
import { die } from "@clip/core";

export async function runRefresh(args: string[], registry: Registry): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip refresh <target>");
  const cfg = await loadConfig();
  const resolved = getTarget(cfg, name);
  if (!["api", "grpc", "graphql", "mcp"].includes(resolved.type)) {
    die(`"${name}" is not an API, gRPC, GraphQL, or MCP target. refresh only applies to those types.`);
  }
  const result = await dispatch(
    cfg,
    {
      targetName: name,
      resolvedTarget: resolved,
      subcommand: "refresh",
      args: [],
      headers: cfg.headers ?? {},
      dryRun: false,
      jsonMode: false,
      passthrough: false,
      env: process.env as Record<string, string>,
    },
    registry,
  );
  process.stdout.write(result.stdout);
}
