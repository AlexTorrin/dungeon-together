#!/usr/bin/env bash
# Запускает в фоне Vite dev server клиента и игровой сервер (Colyseus), ждёт готовности портов.
set -euo pipefail
RUN=/tmp/dt-run
PORT=5173
[ -f "$RUN/workspace" ] || { echo "Сначала запусти setup.sh" >&2; exit 1; }
WS="$(cat "$RUN/workspace")"
[ "$WS" = "$RUN/ws" ] && bash "$(dirname "$0")/sync.sh"

bash "$(dirname "$0")/stop.sh"
# Вывод перенаправлен у всей группы: иначе фоновая оболочка держит stdout вызвавшего.
(cd "$WS/packages/client" && exec pnpm exec vite --port "$PORT" --strictPort) > "$RUN/vite.log" 2>&1 < /dev/null &
(cd "$WS/packages/server" && exec pnpm exec tsx src/index.ts) > "$RUN/server.log" 2>&1 < /dev/null &
timeout 60 bash -c "until curl -sf http://localhost:$PORT >/dev/null; do sleep 0.5; done" \
  || { echo "Vite не поднялся, лог:" >&2; cat "$RUN/vite.log" >&2; exit 1; }
echo "Dev server: http://localhost:$PORT (лог: $RUN/vite.log)"
timeout 60 bash -c "until (echo > /dev/tcp/127.0.0.1/2567) 2>/dev/null; do sleep 0.5; done" \
  || { echo "Игровой сервер не поднялся, лог:" >&2; cat "$RUN/server.log" >&2; exit 1; }
echo "Игровой сервер: ws://localhost:2567 (лог: $RUN/server.log)"
