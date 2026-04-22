import { extension as apiExtension } from "@clip/protocol-api";
import { extension as cliExtension } from "@clip/protocol-cli";
import { extension as graphqlExtension } from "@clip/protocol-graphql";
import { extension as grpcExtension } from "@clip/protocol-grpc";
import { extension as mcpExtension } from "@clip/protocol-mcp";
import { extension as scriptExtension } from "@clip/protocol-script";
import { type ClipExtension, Registry } from "@clip/core";
import type { ExtensionEntry } from "./extension-loader.ts";

export const BUILTIN_EXTENSIONS: ClipExtension[] = [
  cliExtension,
  mcpExtension,
  apiExtension,
  grpcExtension,
  graphqlExtension,
  scriptExtension,
];

/** clip ext list 표시용 내장 extension 최소 메타데이터 */
const BUILTIN_EXTENSION_META: Array<{ name: string; entry: string }> = [
  { name: "protocol-cli",     entry: "@clip/protocol-cli" },
  { name: "protocol-mcp",     entry: "@clip/protocol-mcp" },
  { name: "protocol-api",     entry: "@clip/protocol-api" },
  { name: "protocol-grpc",    entry: "@clip/protocol-grpc" },
  { name: "protocol-graphql", entry: "@clip/protocol-graphql" },
  { name: "protocol-script",  entry: "@clip/protocol-script" },
];

/** Registry에서 builtin type 목록을 파생해 ExtensionEntry[] 생성 */
export function deriveBuiltinEntries(registry: Registry): ExtensionEntry[] {
  return BUILTIN_EXTENSION_META.map((m) => {
    const typeName = m.name.replace(/^protocol-/, "");
    const hasType = registry.getContribution(typeName) !== undefined;
    return {
      name: m.name,
      path: "(builtin)",
      entry: m.entry,
      enabled: true,
      builtin: true,
      contributes: {
        targetTypes: hasType ? [typeName] : [],
        internalCommands: [],
        hooks: [],
        outputFormats: [],
      },
    };
  });
}

export function createDefaultRegistry(): Registry {
  const reg = new Registry();
  for (const ext of BUILTIN_EXTENSIONS) reg.register(ext);
  return reg;
}
