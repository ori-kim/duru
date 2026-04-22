/**
 * extensions/skills/src/extension.ts
 *
 * manifest entry point — extensions.yml에서 `entry: extension.ts`로 선언됨.
 *
 * Phase 2 lazy init: argv에서 "skills" internalCommand 매칭 시 이 파일이 import되고
 * init(api)가 호출되어 clip skills 서브커맨드가 등록된다.
 */
import type { ClipExtension } from "@clip/core";
import { runSkillsCmd } from "./skills.ts";

export const extension: ClipExtension = {
  name: "ext:skills",
  init(api) {
    api.registerInternalCommand("skills", async ({ args }) => {
      await runSkillsCmd(args);
    });
  },
};
