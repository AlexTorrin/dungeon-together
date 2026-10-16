#!/usr/bin/env bash
# Запускает Vite dev server клиента в фоне и ждёт готовности порта.
set -euo pipefail
RUN=/tmp/dt-run
PORT=5173
[ -f "$RUN/workspace" ] || { echo "Сначала запусти setup.sh" >&2; exit 1; }
WS="$(cat "$RUN/workspace")"
[ "$WS" = "$RUN/ws" ] && bash "$(dirname "$0")/sync.sh"

bash "$(dirname "$0")/stop.sh"
(cd "$WS/packages/client" && nohup pnpm exec vite --port "$PORT" --strictPort > "$RUN/vite.log" 2>&1 &)
timeout 60 bash -c "until curl -sf http://localhost:$PORT >/dev/null; do sleep 0.5; done" \
  || { echo "Vite не поднялся, лог:" >&2; cat "$RUN/vite.log" >&2; exit 1; }
echo "Dev server: http://localhost:$PORT (лог: $RUN/vite.log)"
