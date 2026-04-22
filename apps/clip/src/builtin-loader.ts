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

/**
 * clip ext list 표시용 내장 extension 메타데이터.
 * BUILTIN_EXTENSIONS와 순서·목록을 동기화한다.
 */
export const BUILTIN_EXTENSION_ENTRIES: ExtensionEntry[] = [
  {
    name: "protocol-cli",
    path: "(builtin)",
    entry: "@clip/protocol-cli",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["cli"], internalCommands: [], hooks: [], outputFormats: [] },
  },
  {
    name: "protocol-mcp",
    path: "(builtin)",
    entry: "@clip/protocol-mcp",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["mcp"], internalCommands: [], hooks: [], outputFormats: [] },
  },
  {
    name: "protocol-api",
    path: "(builtin)",
    entry: "@clip/protocol-api",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["api"], internalCommands: [], hooks: [], outputFormats: [] },
  },
  {
    name: "protocol-grpc",
    path: "(builtin)",
    entry: "@clip/protocol-grpc",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["grpc"], internalCommands: [], hooks: [], outputFormats: [] },
  },
  {
    name: "protocol-graphql",
    path: "(builtin)",
    entry: "@clip/protocol-graphql",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["graphql"], internalCommands: [], hooks: [], outputFormats: [] },
  },
  {
    name: "protocol-script",
    path: "(builtin)",
    entry: "@clip/protocol-script",
    enabled: true,
    builtin: true,
    contributes: { targetTypes: ["script"], internalCommands: [], hooks: [], outputFormats: [] },
  },
];

export function createDefaultRegistry(): Registry {
  const reg = new Registry();
  for (const ext of BUILTIN_EXTENSIONS) reg.register(ext);
  return reg;
}
