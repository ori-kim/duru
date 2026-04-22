import { extension as apiExtension } from "@clip/protocol-api";
import { extension as cliExtension } from "@clip/protocol-cli";
import { extension as graphqlExtension } from "@clip/protocol-graphql";
import { extension as grpcExtension } from "@clip/protocol-grpc";
import { extension as mcpExtension } from "@clip/protocol-mcp";
import { extension as scriptExtension } from "@clip/protocol-script";
import { type ClipExtension, Registry } from "@clip/core";

export const BUILTIN_EXTENSIONS: ClipExtension[] = [
  cliExtension,
  mcpExtension,
  apiExtension,
  grpcExtension,
  graphqlExtension,
  scriptExtension,
];

export function createDefaultRegistry(): Registry {
  const reg = new Registry();
  for (const ext of BUILTIN_EXTENSIONS) reg.register(ext);
  return reg;
}
