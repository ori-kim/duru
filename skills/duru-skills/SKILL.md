---
name: duru-skills
description: Use when discovering, grouping, importing, exporting, or planning usage of duru skills by groups or tags in this repository or an agent skill folder.
tags: [scope:repo, scope:agent, subject:skills, intent:discover, intent:organize, intent:import-export]
---

# duru-skills

Use this skill for duru skill management. Do not use it as the startup router; `using-duru-herness` owns main-agent startup routing.

## Discovery

1. Run `duru skills group list`.
2. If a group fits, run `duru skills group use <name>`.
3. If no group fits or you need a narrower choice, run `duru skills tag list` then `duru skills list --tag <tag>`.
4. Inspect selected skills with `duru skills show <name>` or their `SKILL.md` before using them.

## Groups

Groups live in `$DURU_HOME/skills/groups.yml`.

```bash
duru skills group list
duru skills group use <name>
duru skills group clear <name>
duru skills group clear --all
duru skills status
```

`group list` shows names, descriptions, and skill names. `group use` exports the listed skills to the target skill root.
`skills status` shows duru-managed skills in the target skill root and prints the searched path.

## Import And Export

```bash
duru skills import <name> --from <root>
duru skills import --all --from <root>
duru skills export <name> --to <root>
duru skills export --all --to <root>
```

Imports and exports link by default. Use `--copy` only when a physical copy is required.

## Tags

```bash
duru skills tag list
duru skills list --tag <tag>
duru skills list --tag <tag> --tag <tag>
```

Use tag search to narrow individual skill candidates. Repeated `--tag` filters by all provided tags.
