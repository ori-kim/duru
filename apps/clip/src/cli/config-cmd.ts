import type { Registry } from "@clip/core";
import { die } from "@clip/core";
import { runAdd } from "./add.ts";
import { runList } from "./list.ts";
import { runRemove } from "./remove.ts";

export async function runConfigCmd(args: string[], registry: Registry): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "list") return runList(registry);
  if (sub === "add") return runAdd(args.slice(1), registry);
  if (sub === "remove") return runRemove(args.slice(1));
  die(`Unknown config subcommand: "${sub}"\nUsage: clip config list|add|remove`);
}
