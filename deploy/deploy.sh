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
# .deploy-lockhash (see below) is excluded for the same reason: it's a marker
# file that only ever exists on the droplet, never in the source tree.
rsync -az --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .superpowers \
  --exclude server/models/*.onnx \
  --exclude .deploy-lockhash \
  ./ "$HOST:$TARGET/"

# npm ci rebuilds node_modules from scratch every time, which on this droplet's
# 1GB RAM means re-extracting sharp/onnxruntime-node's native binaries even
# when package-lock.json didn't change — a needless memory spike on most
# deploys. Skip it when the lockfile is unchanged from the last deploy that
# actually ran it (.deploy-lockhash records that deploy's hash).
if command -v sha256sum >/dev/null 2>&1; then
  LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
else
  LOCK_HASH="$(shasum -a 256 package-lock.json | cut -d' ' -f1)"
fi

ssh "$HOST" "cd $TARGET && \
  if [ -d node_modules ] && [ -f .deploy-lockhash ] && [ \"\$(cat .deploy-lockhash)\" = '$LOCK_HASH' ]; then \
    echo 'package-lock.json unchanged, skipping npm ci'; \
  else \
    npm ci --omit=dev && echo '$LOCK_HASH' > .deploy-lockhash; \
  fi && \
  sudo systemctl restart chia-grove"
echo "deployed $VERSION to $HOST"
