import type { ClipExtension } from "../../extension.ts";
import { executeScript } from "./executor.ts";
import { scriptTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:script",
  init(api) {
    api.registerTargetType({ type: "script", schema: scriptTargetSchema, executor: executeScript });
  },
};
