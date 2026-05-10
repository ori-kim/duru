import type { ClipExtension } from "@clip/core";
import { runSkillsFlowCmd } from "./skills-flow.ts";

export const extension: ClipExtension = {
  name: "ext:skills-flow",
  init(api) {
    api.registerInternalCommand("skills-flow", async ({ args, lateFlags }) => {
      await runSkillsFlowCmd(args, lateFlags);
    });
  },
};
