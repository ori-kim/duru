#!/usr/bin/env bash
# Install duru skills.
#
# Local mode (from cloned repo):
#   ./skills.sh                   # install all skills in this directory
#   ./skills.sh duru-gateway      # install specific skill
#
# Remote mode (curl | bash):
#   curl -fsSL https://raw.githubusercontent.com/ori-kim/duru/main/skills/skills.sh | bash

set -euo pipefail

REPO="ori-kim/duru"
SKILLS_RAW="https://raw.githubusercontent.com/$REPO/main/skills"
KNOWN_SKILLS=(duru-gateway)

if ! command -v duru >/dev/null 2>&1; then
  echo "duru CLI not found. Install:" >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/install.sh | bash" >&2
  exit 1
fi

SCRIPT_DIR=""
SOURCE="${BASH_SOURCE[0]:-}"
# Only resolve SCRIPT_DIR when invoked from a real file (not curl | bash → /dev/fd/N)
if [ -n "$SOURCE" ] && [ "${SOURCE#/dev/fd/}" = "$SOURCE" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$SOURCE")" 2>/dev/null && pwd || true)"
fi

install_local() {
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

install_remote() {
  local name="$1"
  local tmpdir
  tmpdir=$(mktemp -d)
  mkdir -p "$tmpdir/$name"
  echo "installing: $name"
  if ! curl -fsSL "$SKILLS_RAW/$name/SKILL.md" -o "$tmpdir/$name/SKILL.md"; then
    echo "error: skill not found: $name" >&2
    rm -rf "$tmpdir"
    return 1
  fi
  duru skills add "$tmpdir/$name"
  rm -rf "$tmpdir"
}

# Local mode: SCRIPT_DIR exists and contains at least one SKILL.md
if [ -n "$SCRIPT_DIR" ] && compgen -G "$SCRIPT_DIR/*/SKILL.md" >/dev/null; then
  if [ $# -gt 0 ]; then
    for name in "$@"; do install_local "$SCRIPT_DIR/$name"; done
  else
    for dir in "$SCRIPT_DIR"/*/; do install_local "${dir%/}"; done
  fi
else
  # Remote mode
  if [ $# -gt 0 ]; then
    for name in "$@"; do install_remote "$name"; done
  else
    for name in "${KNOWN_SKILLS[@]}"; do install_remote "$name"; done
  fi
fi
