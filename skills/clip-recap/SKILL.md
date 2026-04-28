---
name: clip-recap
description: Query personalized tacit knowledge stored for a target or domain. When working with an external service, org, or process and unfamiliar names/identifiers/conventions appear, call this to retrieve context saved in the user's environment.
---

# clip-recap — Stored tacit knowledge lookup

## When to call
- Before starting work on a target (`clip <target>`) — retrieve identifiers like channels, projects, labels
- When a specific person, team, or role name appears — check `people.<name>` / `team.*` entries
- When domain terms, abbreviations, or process names are ambiguous — check if the bundle has a definition
- When the user uses implicit references like "our team", "that channel", "the usual way"

## What you get
Entry bodies stored in `~/.clip/recap/`. If someone else or a previous session has saved context there, you work from the same shared assumptions.

## Usage
- `clip recap` — list all groups (Targets / Bundles)
- `clip recap <name>` — list entries in a group
- `clip recap <name> <key>` — read entry body
- `clip recap <name> <key> --json-output` — JSON mode
- `clip recap search <kw>` — search across meta and body

If the group has an `overview` entry, start there.

## Writing entries
- `clip <target> recap add --name <n> --description <d> --body <b>`
- `clip <target> recap delete <n>`
- Bundles have no global add/delete — edit `~/.clip/recap/<bundle>/` directly.
