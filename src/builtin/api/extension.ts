import type { ClipExtension } from "../../extension.ts";
import { executeApi } from "./executor.ts";
import { apiTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:api",
  init(api) {
    api.registerTargetType({ type: "api", schema: apiTargetSchema, executor: executeApi });
  },
};
