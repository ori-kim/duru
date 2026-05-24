import { virtualPlugin } from "@duru/virtual-plugins";
import type { SkillMeta, SkillRecord } from "./types.ts";

export type { SkillMeta, SkillRecord };

export function skillsPlugin() {
  return virtualPlugin(async (_cli) => {
    // TODO: implement skill commands
    // duru skills list    → list available skills
    // duru skills show    → show skill detail
    // duru skills run     → run a skill
  });
}
