import type { FileStore } from "@duru/file-store";

export type AppConfig = {
  contextMode?: {
    commands?: readonly string[];
  };
};

export async function readAppConfig(files: FileStore): Promise<AppConfig> {
  return (await files.read<AppConfig>("config.json")) ?? {};
}
