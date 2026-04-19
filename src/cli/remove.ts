import { removeTarget } from "../config.ts";
import { die } from "../utils/errors.ts";

export async function runRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip remove <name>");
  await removeTarget(name);
  console.log(`Removed target "${name}".`);
}
