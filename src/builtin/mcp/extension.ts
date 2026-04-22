import type { ClipExtension, NormalizeCtx } from "../../extension.ts";
import type { ExecutorContext, TargetResult } from "../../extension.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
import { executeMcp } from "./http.ts";
import {
  type McpHttpTarget,
  type McpSseTarget,
  type McpStdioTarget,
  type McpTarget,
  mcpTargetSchema,
} from "./schema.ts";
import { executeMcpSse } from "./sse.ts";
import { executeMcpStdio } from "./stdio.ts";
import { readToolsCache } from "./tools-cache.ts";

function executeMcpUnified(target: McpTarget, ctx: ExecutorContext): Promise<TargetResult> {
  if (target.transport === "stdio") return executeMcpStdio(target as McpStdioTarget, ctx);
  if (target.transport === "sse") return executeMcpSse(target as McpSseTarget, ctx);
  return executeMcp(target as McpHttpTarget, ctx);
}

function normalizeMcp(t: McpTarget, ctx: NormalizeCtx): McpTarget {
  if (t.transport === "stdio") return t;
  const http = t as McpHttpTarget | McpSseTarget;
  return {
    ...http,
    headers: subRecord(http.headers, ctx.env),
    profiles: subProfiles(http.profiles, ctx.env, ["headers"]),
  } as McpTarget;
}

export const extension: ClipExtension = {
  name: "builtin:mcp",
  init(api) {
    api.registerTargetType({
      type: "mcp",
      schema: mcpTargetSchema,
      executor: (target, ctx) => executeMcpUnified(target as McpTarget, ctx),
      describeTools: (_, { targetName }) => readToolsCache(targetName),
      normalizeConfig: (parsed, ctx) => normalizeMcp(parsed as McpTarget, ctx),
    });
  },
};
