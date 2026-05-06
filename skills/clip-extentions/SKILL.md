---
name: clip-extentions
description: Build, install, update, and manage clip extensions. Use this whenever the user asks about clip extensions, clip ext, extension manifests, installing extensions from GitHub, creating a new clip extension, or misspellings like "extentions". Route by use case and read only the relevant reference file: create, install, or manage.
tags: [clip, extensions, typescript]
---

# clip-extentions

Use this skill for clip extensions. The skill name intentionally follows the requested spelling, but the product term is **extensions** and the CLI command is `clip ext`.

## Route By Use Case

Read only the reference file needed for the user's request:

| User intent | Read |
|---|---|
| Create, scaffold, implement, design, or fix extension code | `references/create.md` |
| Install, update, uninstall, package for GitHub, extension index, or metadata | `references/install.md` |
| List, enable, disable, reload, inspect, debug, or check extension state | `references/manage.md` |

If the request spans multiple areas, read them in this order: `manage.md` for current state, then `create.md` or `install.md` for the actual work.

## Initial Commands

For local clip state, start with:

```sh
clip ext list
clip ext --help
```

For repo implementation details, prefer these files before guessing:

- `docs/ko/08-extensions.md` or `docs/en/08-extensions.md`
- `apps/clip/src/commands/ext.ts`
- `packages/core/src/extension.ts`
- `extensions/*/src/extension.ts`

## Extension Shape

Choose the smallest extension shape that fits:

| Need | Shape | API |
|---|---|---|
| Add `clip <verb> ...` | Internal command | `api.registerInternalCommand()` |
| Modify/log/guard existing target calls | Hook | `api.registerHook()` |
| Add a new target protocol | Target type | `api.registerTargetType()` + `api.registerContribution()` |
| Improve failures | Error handler | `api.registerErrorHandler()` |
| Change output rendering | Presenter/renderer | `api.registerResultPresenter()` / `api.registerOutputRenderer()` |

If unsure, prefer an internal command for workflow automation, a hook for cross-cutting policy, and a target type only when `clip add` plus `clip <target> <subcommand>` need a new protocol.
