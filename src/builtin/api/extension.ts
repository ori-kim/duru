import type { ClipExtension } from "../../extension.ts";
import { describeApiTools, executeApi } from "./executor.ts";
import { apiTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:api",
  init(api) {
    api.registerTargetType({
      type: "api",
      schema: apiTargetSchema,
      executor: executeApi,
      describeTools: (target, { targetName }) => describeApiTools(target, targetName),
    });
  },
};
