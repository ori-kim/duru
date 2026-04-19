import type { ClipExtension } from "../../extension.ts";
import { executeCli } from "./executor.ts";
import { cliTargetSchema } from "./schema.ts";

export const extension: ClipExtension = {
  name: "builtin:cli",
  init(api) {
    api.registerTargetType({ type: "cli", schema: cliTargetSchema, executor: executeCli });
  },
};
