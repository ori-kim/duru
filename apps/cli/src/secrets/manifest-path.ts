import { join } from "node:path";

export function manifestPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const home = env.DURU_HOME ?? join(env.HOME ?? ".", ".duru");
  return join(home, "duru.secrets.json");
}
