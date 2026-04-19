import { extension as apiExtension } from "./builtin/api/extension.ts";
import { extension as cliExtension } from "./builtin/cli/extension.ts";
import { extension as graphqlExtension } from "./builtin/graphql/extension.ts";
import { extension as grpcExtension } from "./builtin/grpc/extension.ts";
import { extension as mcpExtension } from "./builtin/mcp/extension.ts";
import { extension as scriptExtension } from "./builtin/script/extension.ts";
import { type ClipExtension, Registry } from "./extension.ts";
import { authHookExtension } from "./hooks/auth-hook.ts";

export const BUILTIN_EXTENSIONS: ClipExtension[] = [
  authHookExtension,
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
