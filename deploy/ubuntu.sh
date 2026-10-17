#!/usr/bin/env bash
# Установка и обновление Dungeon Togethere на сервере Ubuntu (22.04/24.04).
#
#   sudo bash ubuntu.sh            # первый раз — ставит всё; повторный запуск — обновляет
#
# Что делает:
#   1. Ставит Node.js 22, pnpm, git, nginx.
#   2. Клонирует (или обновляет) репозиторий в $APP_DIR, ставит зависимости, собирает клиент.
#   3. Запускает игровой сервер как systemd-сервис dungeon-togethere (порт $GAME_PORT).
#   4. nginx на порту $WEB_PORT отдаёт собранный клиент, а запросы к $SERVER_PATH/ (HTTP и
#      WebSocket) проксирует игровому серверу.
#   5. Если включён ufw — открывает порт $WEB_PORT.
#
# Клиент собирается с VITE_SERVER_URL=$SERVER_PATH и ходит к серверу через тот же домен и порт,
# что и страница, поэтому наружу нужен только $WEB_PORT — работает и за Cloudflare, и за HTTPS.
# Профили игроков — в $DATA_DIR.
#
# Настройки — переменными окружения: sudo REPO=... BRANCH=... bash ubuntu.sh
set -euo pipefail

REPO="${REPO:-https://github.com/AlexTorrin/dungeon-together.git}"
BRANCH="${BRANCH:-main}"
APP_DIR="${APP_DIR:-/opt/dungeon-togethere}"
DATA_DIR="${DATA_DIR:-/var/lib/dungeon-togethere}"
APP_USER="${APP_USER:-dungeon}"
GAME_PORT="${GAME_PORT:-2567}"
WEB_PORT="${WEB_PORT:-80}"
SERVER_PATH="${SERVER_PATH:-/server}"
NODE_MAJOR="${NODE_MAJOR:-22}"
PNPM_VERSION="${PNPM_VERSION:-12.14.0}"
SERVICE=dungeon-togethere

log() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }

if [[ $EUID -ne 0 ]]; then
  echo "Запустите через sudo: sudo bash $0" >&2
  exit 1
fi

log "Системные пакеты"
apt-get update -q
apt-get install -y -q ca-certificates curl git nginx

if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  log "Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -q nodejs
fi

if [[ "$(pnpm --version 2>/dev/null || true)" != "$PNPM_VERSION" ]]; then
  log "pnpm $PNPM_VERSION"
  npm install -g "pnpm@$PNPM_VERSION"
fi
PNPM="$(command -v pnpm)"

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Пользователь $APP_USER"
  useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$DATA_DIR"

log "Код: $REPO ($BRANCH) → $APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$APP_DIR"
fi
echo "Версия: $(git -C "$APP_DIR" log -1 --format='%h %s')"

log "Зависимости и сборка клиента"
cd "$APP_DIR"
"$PNPM" install --frozen-lockfile
VITE_SERVER_URL="$SERVER_PATH" "$PNPM" --filter @dt/client build

log "systemd-сервис $SERVICE"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=Dungeon Togethere game server
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/packages/server
Environment=PORT=$GAME_PORT
Environment=DT_PROFILES_FILE=$DATA_DIR/profiles.json
ExecStart=$PNPM start
Restart=always
RestartSec=3
# Сервису нужно писать только в каталог профилей
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --quiet "$SERVICE"
systemctl restart "$SERVICE"

log "nginx: клиент на порту $WEB_PORT"
cat > "/etc/nginx/sites-available/$SERVICE" <<EOF
server {
    listen $WEB_PORT default_server;
    listen [::]:$WEB_PORT default_server;
    root $APP_DIR/packages/client/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }
    # Игровой сервер: слеш в конце proxy_pass срезает $SERVER_PATH из пути.
    # Upgrade/Connection — чтобы через прокси прошёл WebSocket.
    location $SERVER_PATH/ {
        proxy_pass http://127.0.0.1:$GAME_PORT/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # Без этого nginx закроет тихое WebSocket-соединение через 60 с
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
    }
    # Собранные vite-файлы с хешем в имени можно кешировать надолго
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF
ln -sf "/etc/nginx/sites-available/$SERVICE" "/etc/nginx/sites-enabled/$SERVICE"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  log "ufw: открываю порт $WEB_PORT"
  ufw allow "$WEB_PORT/tcp"
fi

log "Проверка"
# Сервер отвечает через nginx: 401 (нет токена) — значит, и прокси, и сервер на месте
up=false
for _ in {1..20}; do
  if [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$WEB_PORT$SERVER_PATH/profile")" == 401 ]]; then
    up=true
    break
  fi
  sleep 1
done
if [[ $up != true ]] || ! systemctl is-active --quiet "$SERVICE"; then
  echo "Сервер не отвечает через nginx ($SERVER_PATH/profile). Логи сервиса:" >&2
  journalctl -u "$SERVICE" -n 30 --no-pager >&2
  exit 1
fi

# Другой сайт nginx с server_name вашего домена перехватит запросы раньше нашего default_server
others="$(grep -lsE '^\s*server\s*\{' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf | grep -v "/$SERVICE\$" || true)"
if [[ -n $others ]]; then
  echo
  echo "Внимание: в nginx включены другие сайты — если один из них обслуживает ваш домен, игра"
  echo "по домену откроется не отсюда. Уберите их или перенесите в них location $SERVER_PATH/:"
  echo "$others"
fi

IP="$(hostname -I | awk '{print $1}')"
cat <<EOF

Готово.
  Игра:          http://$IP$([[ $WEB_PORT == 80 ]] || echo ":$WEB_PORT")
  Сервер:        http://$IP$([[ $WEB_PORT == 80 ]] || echo ":$WEB_PORT")$SERVER_PATH (наружу порт $GAME_PORT не нужен)
  Профили:       $DATA_DIR/profiles.json
  Логи сервера:  journalctl -u $SERVICE -f
  Обновить:      sudo bash $APP_DIR/deploy/ubuntu.sh
EOF
