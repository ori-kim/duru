# Clip Skill Groups

Use this reference when composing several skills into a named group or activating/deactivating groups for an agent.

## Group Commands

```sh
clip skills group create work linear-feature slack notion --description "Work skills"
clip skills group list
clip skills group show work
clip skills group add work jira
clip skills group rm work slack
clip skills group delete work
clip skills group activate work --to claude-code
clip skills group deactivate work --from claude-code
```

## Activate And Swap Groups

```sh
clip skills group activate work --to claude-code
clip skills group deactivate work --from claude-code
clip skills group activate personal --to claude-code
```

Activation creates symlinks for all group skills in the selected agent. Missing registry skills are skipped with warnings.

## groups.yml

Groups are stored in:

```text
~/.clip/skills/groups.yml
```

You can edit it directly:

```yaml
groups:
  work:
    description: Work-related skills
    skills:
      - linear-feature
      - slack
  personal:
    skills:
      - recap
```
