import { readFile } from "node:fs/promises";
import type { GatewayEnvService } from "@duru/cli-gateway";
import { parseDotenv } from "@duru/cli-gateway";
import type { DuruFileHome } from "@duru/file-store";

export type CreateAppGatewayEnvServiceOptions = {
  fileHome: DuruFileHome;
};

export function createAppGatewayEnvService(options: CreateAppGatewayEnvServiceOptions): GatewayEnvService {
  return {
    async loadTargetEnv({ target, type }) {
      const env = new Map<string, string>();
      if (!isSafeSegment(type) || !isSafeSegment(target)) return env;

      const globalText = await readTextSafe(options.fileHome.resolve(".env"));
      if (globalText) merge(env, parseDotenv(globalText));

      const targetText = await readTextSafe(options.fileHome.resolve(`gateway/${type}/${target}/.env`));
      if (targetText) merge(env, parseDotenv(targetText));

      return env;
    },
  };
}

async function readTextSafe(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function merge(into: Map<string, string>, from: ReadonlyMap<string, string>): void {
  for (const [key, value] of from) into.set(key, value);
}

function isSafeSegment(segment: string): boolean {
  return Boolean(segment) && !segment.includes("/") && !segment.includes("\\") && segment !== "." && segment !== "..";
}
