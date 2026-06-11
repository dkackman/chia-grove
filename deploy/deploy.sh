#!/usr/bin/env bash
# Build locally, sync to the droplet, install prod deps, restart.
# Usage: deploy/deploy.sh user@host
set -euo pipefail

HOST="${1:?usage: deploy/deploy.sh user@host}"
TARGET=/opt/chia-grove

npm run build

rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  ./ "$HOST:$TARGET/"

ssh "$HOST" "cd $TARGET && npm install --omit=dev && sudo systemctl restart chia-grove"
echo "deployed to $HOST"
