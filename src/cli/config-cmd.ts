import { die } from "../utils/errors.ts";
import { runAdd } from "./add.ts";
import { runList } from "./list.ts";
import { runRemove } from "./remove.ts";

export async function runConfigCmd(args: string[]): Promise<void> {
  const sub = args[0];
  if (!sub || sub === "list") return runList();
  if (sub === "add") return runAdd(args.slice(1));
  if (sub === "remove") return runRemove(args.slice(1));
  die(`Unknown config subcommand: "${sub}"\nUsage: clip config list|add|remove`);
}
