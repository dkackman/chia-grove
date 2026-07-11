#!/usr/bin/env bash
# Build locally, stamp version.json, sync to the droplet, install prod deps, restart.
# Usage: deploy/deploy.sh user@host [version]
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host [version]}"
VERSION="${2:-$(git describe --tags --always --dirty)}"
TARGET=/opt/chia-grove

printf '{"appVersion":"%s","gitSha":"%s","builtAt":"%s"}\n' \
  "$VERSION" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > version.json
# version.json is git-ignored and meant to be absent locally (see version.ts) —
# it only needs to exist transiently so rsync ships it to the droplet.
trap 'rm -f version.json' EXIT

npm run build

# server/models/*.onnx (~23MB, effectively static) is excluded from the
# per-deploy sync — see deploy/README or the LOCAL_NSFW_MODEL_PATH note in
# server/CLAUDE.md. Place it on the droplet once via:
#   scp server/models/opennsfw2.onnx "$HOST:$TARGET/server/models/"
# --delete + --exclude leaves files matching the exclude untouched on the
# destination, so this survives future deploys without being re-synced.
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  --exclude server/models/*.onnx \
  ./ "$HOST:$TARGET/"

ssh "$HOST" "cd $TARGET && npm ci --omit=dev && sudo systemctl restart chia-grove"
echo "deployed $VERSION to $HOST"
