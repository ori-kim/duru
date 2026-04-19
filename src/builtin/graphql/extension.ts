import type { ClipExtension } from "../../extension.ts";
import { executeGraphql } from "./executor.ts";
import { graphqlTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:graphql",
  init(api) {
    api.registerTargetType({ type: "graphql", schema: graphqlTargetSchema, executor: executeGraphql });
  },
};
