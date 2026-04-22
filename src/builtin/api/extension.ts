import type { ClipExtension, NormalizeCtx } from "../../extension.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
import { describeApiTools, executeApi } from "./executor.ts";
import { type ApiTarget, apiTargetSchema } from "./schema.ts";

function normalizeApi(t: ApiTarget, ctx: NormalizeCtx): ApiTarget {
  return {
    ...t,
    headers: subRecord(t.headers, ctx.env),
    profiles: subProfiles(t.profiles, ctx.env, ["headers"]),
  };
}

export const extension: ClipExtension = {
  name: "builtin:api",
  init(api) {
    api.registerTargetType({
      type: "api",
      schema: apiTargetSchema,
      executor: executeApi,
      describeTools: (target, { targetName }) => describeApiTools(target, targetName),
      normalizeConfig: (parsed, ctx) => normalizeApi(parsed as ApiTarget, ctx),
    });
  },
};
