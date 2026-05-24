#!/bin/sh
set -eu

REPO="ori-kim/duru"
INSTALL_DIR="${DURU_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Darwin" ]; then
  echo "error: unsupported OS '$OS'. Only macOS is supported." >&2
  echo "Download manually: https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

case "$ARCH" in
  arm64) ASSET="duru-darwin-arm64" ;;
  *)
    echo "error: unsupported architecture '$ARCH'. Only Apple Silicon (arm64) is supported." >&2
    echo "Download manually: https://github.com/$REPO/releases/latest" >&2
    exit 1
    ;;
esac

BASE_URL="https://github.com/$REPO/releases/latest/download"

echo "Downloading $ASSET..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$BASE_URL/$ASSET"        -o "$INSTALL_DIR/duru"
curl -fsSL "$BASE_URL/$ASSET.sha256" -o /tmp/duru.sha256

# Verify checksum
EXPECTED="$(awk '{print $1}' /tmp/duru.sha256)"
ACTUAL="$(shasum -a 256 "$INSTALL_DIR/duru" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "error: checksum mismatch. Expected $EXPECTED, got $ACTUAL." >&2
  rm -f "$INSTALL_DIR/duru"
  exit 1
fi
rm -f /tmp/duru.sha256

chmod +x "$INSTALL_DIR/duru"

# Remove all extended attributes (including quarantine) and apply ad-hoc signature
xattr -cr "$INSTALL_DIR/duru" 2>/dev/null || true
codesign --force --sign - "$INSTALL_DIR/duru" 2>/dev/null || true

echo "Installed duru to $INSTALL_DIR/duru"
"$INSTALL_DIR/duru" --version

# Warn if install dir is not in PATH
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "Note: $INSTALL_DIR is not in your PATH."
    echo "Add this to your shell profile:"
    echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
    ;;
esac

BIND_DIR="$HOME/.duru/bin"
echo ""
echo "Native bind directory: $BIND_DIR"
echo "To use bound targets without the 'duru' prefix, add to your shell profile"
echo "(before other PATH entries so duru intercepts the commands):"
echo "  export PATH=\"$BIND_DIR:\$PATH\""
echo ""
echo "Then: duru gateway bind gh gh   # 'gh' will now route through duru"

# zsh completion + autosuggestions
echo ""
printf "Configure zsh completion in ~/.zshrc? (y/N) "
read SETUP_ZSH </dev/tty || SETUP_ZSH="n"
case "$SETUP_ZSH" in
  [yY]|[yY][eE][sS])
    ZSHRC="$HOME/.zshrc"
    if grep -q 'duru completion zsh' "$ZSHRC" 2>/dev/null; then
      echo "Already configured in $ZSHRC"
    else
      printf '\n# duru zsh completion\neval "$(duru completion zsh)"\n' >> "$ZSHRC"
      echo "Added completion to $ZSHRC"
    fi
    if ! grep -q 'ZSH_AUTOSUGGEST_STRATEGY' "$ZSHRC" 2>/dev/null; then
      printf 'ZSH_AUTOSUGGEST_STRATEGY=(history completion)\n' >> "$ZSHRC"
      echo "Added ZSH_AUTOSUGGEST_STRATEGY to $ZSHRC"
    fi
    echo "Restart your shell or run: source $ZSHRC"
    ;;
  *)
    echo "Skipped. Add to ~/.zshrc to enable:"
    echo '  eval "$(duru completion zsh)"'
    ;;
esac

# Built-in skills (via duru skills add)
SKILLS="duru-gateway"
echo ""
printf "Install built-in skills (%s)? (y/N) " "$SKILLS"
read INSTALL_SKILLS </dev/tty || INSTALL_SKILLS="n"
case "$INSTALL_SKILLS" in
  [yY]|[yY][eE][sS])
    SKILLS_RAW="https://raw.githubusercontent.com/$REPO/main/skills"
    TMP_SKILLS="$(mktemp -d)"
    for skill in $SKILLS; do
      echo "Installing skill: $skill"
      mkdir -p "$TMP_SKILLS/$skill"
      if curl -fsSL "$SKILLS_RAW/$skill/SKILL.md" -o "$TMP_SKILLS/$skill/SKILL.md"; then
        "$INSTALL_DIR/duru" skills add "$TMP_SKILLS/$skill"
      else
        echo "warn: failed to fetch $skill, skipped" >&2
      fi
    done
    rm -rf "$TMP_SKILLS"
    ;;
  *)
    echo "Skipped. Run later:"
    echo "  curl -fsSL https://raw.githubusercontent.com/$REPO/main/skills/skills.sh | bash"
    ;;
esac
