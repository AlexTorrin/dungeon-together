#!/usr/bin/env bash
# Синхронизирует исходники репо в зеркало /tmp/dt-run/ws (node_modules зеркала не трогает).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
WS=/tmp/dt-run/ws
mkdir -p "$WS"
rsync -a --delete \
  --exclude node_modules --exclude dist --exclude assets --exclude .claude \
  --exclude '*.zip' --exclude /client --exclude /packages/server/data \
  "$REPO/" "$WS/"
ln -sfn "$REPO/assets" "$WS/assets"
