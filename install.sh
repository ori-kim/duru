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
  arm64)  ASSET="clip-darwin-arm64" ;;
  x86_64) ASSET="clip-darwin-x64" ;;
  *)
    echo "error: unsupported architecture '$ARCH'." >&2
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
