#!/usr/bin/env bash
# Install all skills in this directory into DURU_HOME via `duru skills add`.
#
# Usage:
#   ./skills.sh             # install all
#   ./skills.sh <name>...   # install specific skills by directory name

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v duru >/dev/null 2>&1; then
  echo "duru CLI not found. Install from https://github.com/ori-kim/duru/releases" >&2
  exit 1
fi

install_one() {
  local dir="$1"
  local name
  name=$(basename "$dir")
  if [ ! -f "$dir/SKILL.md" ]; then
    echo "skip: $name (no SKILL.md)" >&2
    return
  fi
  echo "installing: $name"
  duru skills add "$dir"
}

if [ $# -gt 0 ]; then
  for name in "$@"; do
    install_one "$SCRIPT_DIR/$name"
  done
else
  for dir in "$SCRIPT_DIR"/*/; do
    install_one "${dir%/}"
  done
fi
