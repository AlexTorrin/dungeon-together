#!/usr/bin/env bash
# Готовит рабочее место для запуска клиента: зависимости + Playwright.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../../../.." && pwd)"
RUN=/tmp/dt-run
SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$RUN"

command -v pnpm >/dev/null || npm i -g pnpm >/dev/null

# Можно ли создавать симлинки прямо в репозитории?
probe="$REPO/.dt-symlink-probe"
if ln -s . "$probe" 2>/dev/null; then
  rm -f "$probe"
  WS="$REPO"
  (cd "$WS" && pnpm install --frozen-lockfile)
else
  WS="$RUN/ws"
  bash "$SCRIPTS/sync.sh"
  (cd "$WS" && pnpm install --frozen-lockfile)
fi
echo "$WS" > "$RUN/workspace"

mkdir -p "$RUN/pw"
cp "$SCRIPTS/shot.mjs" "$RUN/pw/shot.mjs"
if [ ! -d "$RUN/pw/node_modules/playwright" ]; then
  (cd "$RUN/pw" && npm init -y >/dev/null && npm i -s playwright && npx playwright install --with-deps chromium)
fi
echo "WORKSPACE=$WS"
