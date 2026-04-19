import type { ClipExtension } from "../../extension.ts";
import { describeGraphqlTools, executeGraphql } from "./executor.ts";
import { graphqlTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:graphql",
  init(api) {
    api.registerTargetType({
      type: "graphql",
      schema: graphqlTargetSchema,
      executor: executeGraphql,
      describeTools: (target, { targetName }) => describeGraphqlTools(target, targetName),
    });
  },
};
