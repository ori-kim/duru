#!/bin/sh
set -eu

REPO="ori-kim/cli-proxy"
INSTALL_DIR="${CLIP_INSTALL_DIR:-$HOME/.local/bin}"

# Detect platform
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$OS" != "Darwin" ]; then
  echo "error: unsupported OS '$OS'. Only macOS is supported." >&2
  echo "Download manually: https://github.com/$REPO/releases/latest" >&2
  exit 1
fi

case "$ARCH" in
  arm64) ASSET="clip-darwin-arm64" ;;
  *)
    echo "error: unsupported architecture '$ARCH'. Only Apple Silicon (arm64) is supported." >&2
    echo "Download manually: https://github.com/$REPO/releases/latest" >&2
    exit 1
    ;;
esac

BASE_URL="https://github.com/$REPO/releases/latest/download"

echo "Downloading $ASSET..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$BASE_URL/$ASSET"        -o "$INSTALL_DIR/clip"
curl -fsSL "$BASE_URL/$ASSET.sha256" -o /tmp/clip.sha256

# Verify checksum
EXPECTED="$(awk '{print $1}' /tmp/clip.sha256)"
ACTUAL="$(shasum -a 256 "$INSTALL_DIR/clip" | awk '{print $1}')"
if [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "error: checksum mismatch. Expected $EXPECTED, got $ACTUAL." >&2
  rm -f "$INSTALL_DIR/clip"
  exit 1
fi
rm -f /tmp/clip.sha256

chmod +x "$INSTALL_DIR/clip"

# Remove all extended attributes (including quarantine) and apply ad-hoc signature
xattr -cr "$INSTALL_DIR/clip" 2>/dev/null || true
codesign --force --sign - "$INSTALL_DIR/clip" 2>/dev/null || true

echo "Installed clip to $INSTALL_DIR/clip"
"$INSTALL_DIR/clip" --version

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

BIND_DIR="$HOME/.clip/bin"
echo ""
echo "Native bind directory: $BIND_DIR"
echo "To use bound targets without the 'clip' prefix, add to your shell profile"
echo "(before other PATH entries so clip intercepts the commands):"
echo "  export PATH=\"$BIND_DIR:\$PATH\""
echo ""
echo "Then: clip bind gh   # 'gh' will now route through clip"

# Optional: Agents skill (via skills.sh)
echo ""
printf "Install Agents skill via skills.sh? (y/N) "
read INSTALL_SKILL </dev/tty || INSTALL_SKILL="n"
case "$INSTALL_SKILL" in
  [yY]|[yY][eE][sS])
    npx skills add ori-kim/cli-proxy </dev/tty
    ;;
  *)
    echo "Skipped. Run 'npx skills add ori-kim/cli-proxy' to install later."
    ;;
esac

# Optional: zsh completion + autosuggestions
echo ""
printf "Configure zsh completion in ~/.zshrc? (y/N) "
read SETUP_ZSH </dev/tty || SETUP_ZSH="n"
case "$SETUP_ZSH" in
  [yY]|[yY][eE][sS])
    ZSHRC="$HOME/.zshrc"
    if grep -q 'clip completion zsh' "$ZSHRC" 2>/dev/null; then
      echo "Already configured in $ZSHRC"
    else
      printf '\n# clip zsh completion\neval "$(clip completion zsh)"\n' >> "$ZSHRC"
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
    echo '  eval "$(clip completion zsh)"'
    ;;
esac
