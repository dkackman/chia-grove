#!/usr/bin/env bash
# Build locally, stamp version.json, sync to the droplet, install prod deps, restart.
# Usage: deploy/deploy.sh user@host [version]
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host [version]}"
VERSION="${2:-$(git describe --tags --always --dirty)}"
TARGET=/opt/chia-grove

printf '{"appVersion":"%s","gitSha":"%s","builtAt":"%s"}\n' \
  "$VERSION" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > version.json

npm run build

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  ./ "$HOST:$TARGET/"

ssh "$HOST" "cd $TARGET && npm ci --omit=dev && sudo systemctl restart chia-grove"
echo "deployed $VERSION to $HOST"
