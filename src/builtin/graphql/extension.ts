import type { ClipExtension, NormalizeCtx } from "../../extension.ts";
import { subProfiles, subRecord } from "../../utils/env-sub.ts";
import { describeGraphqlTools, executeGraphql } from "./executor.ts";
import { type GraphqlTarget, graphqlTargetSchema } from "./schema.ts";

function normalizeGraphql(t: GraphqlTarget, ctx: NormalizeCtx): GraphqlTarget {
  return {
    ...t,
    headers: subRecord(t.headers, ctx.env),
    profiles: subProfiles(t.profiles, ctx.env, ["headers"]),
  };
}

export const extension: ClipExtension = {
  name: "builtin:graphql",
  init(api) {
    api.registerTargetType({
      type: "graphql",
      schema: graphqlTargetSchema,
      executor: executeGraphql,
      describeTools: (target, { targetName, headers }) => describeGraphqlTools(target, targetName, headers),
      normalizeConfig: (parsed, ctx) => normalizeGraphql(parsed as GraphqlTarget, ctx),
      aclRule: { skipSubcommands: ["describe", "types"] },
    });
  },
};
