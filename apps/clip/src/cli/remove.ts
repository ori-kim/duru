import { removeTarget } from "@clip/core";
import { die } from "@clip/core";

export async function runRemove(args: string[]): Promise<void> {
  const name = args[0];
  if (!name) die("Usage: clip remove <name>");
  await removeTarget(name);
  console.log(`Removed target "${name}".`);
}
