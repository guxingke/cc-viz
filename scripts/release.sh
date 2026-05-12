#!/usr/bin/env bash
# Freeze the current source tree into a release copy, install deps once,
# build CSS, then ask svcctl to restart the service.
# This decouples the running daemon from the live development checkout.

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${CC_VIZ_RELEASE_DIR:-$HOME/.local/share/cc-viz}"
SERVICE_NAME="${CC_VIZ_SERVICE_NAME:-cc-viz}"

echo "→ source : $SRC_DIR"
echo "→ target : $TARGET"

mkdir -p "$TARGET"

# rsync the source tree, excluding dev-only / generated artifacts.
rsync -a --delete \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=src/styles.built.css \
  --exclude=.DS_Store \
  "$SRC_DIR/" "$TARGET/"

echo "→ installing deps (frozen lockfile)"
(cd "$TARGET" && bun install --frozen-lockfile)

echo "→ building CSS"
(cd "$TARGET" && NO_CSS_WATCH=1 \
  ./node_modules/.bin/tailwindcss -i src/styles.css -o src/styles.built.css)

if command -v svcctl >/dev/null 2>&1; then
  echo "→ restarting service via svcctl"
  svcctl restart "$SERVICE_NAME" || echo "  (service not loaded yet; run 'svcctl sync' first)"
else
  echo "  svcctl not on PATH — skipping restart"
fi

echo "✓ release complete"
