#!/usr/bin/env bash
# Install duru skills via the vercel-labs/skills ecosystem.
# Targets any detected AI agent (Claude Code, Cursor, Copilot, etc.).
#
# Usage:
#   ./skills.sh                                       # install all duru skills
#   ./skills.sh duru-gateway                          # install a specific skill
#   DURU_SKILLS_REPO=other/repo ./skills.sh           # install from another repo
#   curl -fsSL https://raw.githubusercontent.com/ori-kim/duru/main/skills/skills.sh | bash

set -euo pipefail

REPO="${DURU_SKILLS_REPO:-ori-kim/duru}"

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found. Install Node.js first." >&2
  exit 1
fi

npx skills add "$REPO" "$@"
