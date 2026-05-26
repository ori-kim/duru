import type { FileStore } from "@duru/file-store";
import type { HistoryConfig, HistoryDefaultAction } from "./types.ts";

const CONFIG_FILE = "config.yml";

const ALWAYS_IGNORE = new Set(["history"]);

export type IgnoreMatcher = {
  isIgnored(argv: readonly string[]): boolean;
};

export async function loadHistoryConfig(files: FileStore): Promise<HistoryConfig> {
  try {
    return normalizeConfig((await files.read<HistoryConfig>(CONFIG_FILE)) ?? {});
  } catch {
    return {};
  }
}

export async function loadIgnoreConfig(files: FileStore): Promise<HistoryConfig> {
  return loadHistoryConfig(files);
}

export async function saveDefaultAction(files: FileStore, action: HistoryDefaultAction): Promise<void> {
  const config = await loadHistoryConfig(files);
  await files.write(CONFIG_FILE, { ...config, defaultAction: action });
}

export function createIgnoreMatcher(config: HistoryConfig): IgnoreMatcher {
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

function normalizeConfig(config: HistoryConfig): HistoryConfig {
  return {
    ...config,
    defaultAction: isDefaultAction(config.defaultAction) ? config.defaultAction : undefined,
    limit: normalizeLimit(config.limit),
  };
}

function isDefaultAction(value: unknown): value is HistoryDefaultAction {
  return value === "list" || value === "pick";
}

function normalizeLimit(value: unknown): number | undefined {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return undefined;
  return Math.floor(limit);
}
