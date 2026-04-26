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
    }, {
      description: "manage reusable prompt-template skills",
      completion: () => `
  if (( CURRENT == 3 )); then
    local -a subcmds=(
      'add:create a new skill scaffold'
      'list:list all skills'
      'show:print raw SKILL.md'
      'get:render skill with input substitution'
      'rm:remove from registry'
      'install:symlink skill into agent'
      'uninstall:remove skill from agent'
      'group:manage skill groups'
      'pull:import external skill directory'
    )
    _describe -t skills-commands 'skills commands' subcmds
  elif (( CURRENT == 4 )); then
    case "\${words[3]}" in
      group)
        local -a group_subcmds=(
          'create:define a new group'
          'list:list all groups'
          'show:list skills in a group'
          'add:add skill to group'
          'rm:remove skill from group'
          'delete:delete group definition'
          'activate:symlink all group skills to an agent'
          'deactivate:remove group symlinks from an agent'
        )
        _describe -t group-commands 'group subcommands' group_subcmds
        ;;
      install|uninstall|show|get|rm)
        local skills_dir="\${CLIP_HOME:-$HOME/.clip}/skills"
        local -a skill_names=()
        for d in "$skills_dir/"*(N/); do
          skill_names+=("\${d:t}")
        done
        (( \${#skill_names} )) && _describe -t skill-names 'skill name' skill_names
        ;;
    esac
  fi`,
    });
  },
};
