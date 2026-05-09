import type { ClipExtension } from "@clip/core";
import { sanitizeTargetResult } from "./sanitize.ts";

export const extension: ClipExtension = {
  name: "sanitizer",
  init(api) {
    api.registerHook("target-end", (ctx) => {
      if (!ctx.result) return;
      return { result: sanitizeTargetResult(ctx.result) };
    });
  },
};
