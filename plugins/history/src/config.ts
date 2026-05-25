import type { FileStore } from "@duru/file-store";
import type { HistoryIgnoreConfig } from "./types.ts";

const CONFIG_FILE = "config.yml";

const ALWAYS_IGNORE = new Set(["history"]);

export type IgnoreMatcher = {
  isIgnored(argv: readonly string[]): boolean;
};

export async function loadIgnoreConfig(files: FileStore): Promise<HistoryIgnoreConfig> {
  try {
    return (await files.read<HistoryIgnoreConfig>(CONFIG_FILE)) ?? {};
  } catch {
    return {};
  }
}

export function createIgnoreMatcher(config: HistoryIgnoreConfig): IgnoreMatcher {
  const patterns = (config.ignore ?? []).map((p) => p.trim()).filter(Boolean);
  return {
    isIgnored(argv) {
      const head = argv[0];
      if (head && ALWAYS_IGNORE.has(head)) return true;
      if (!head) return true;
      const joined = argv.join(" ");
      for (const pattern of patterns) {
        if (pattern === head) return true;
        if (joined === pattern) return true;
        if (joined.startsWith(`${pattern} `)) return true;
      }
      return false;
    },
  };
}
