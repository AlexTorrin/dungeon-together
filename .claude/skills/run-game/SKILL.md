---
name: run-game
description: Запуск и проверка клиента Dungeon Togethere (Vite + Phaser) в Linux-песочнице — dev server на :5173 и headless-скриншот через Playwright с проверкой ошибок консоли и пустого кадра. Используй, когда нужно запустить игру, посмотреть, как она выглядит, или проверить изменение в реальном клиенте.
---

# Запуск игры

Все скрипты лежат рядом: `.claude/skills/run-game/scripts/`. Пути ниже — от корня репозитория.

## 1. Подготовка (один раз за сессию и после смены зависимостей)

```bash
bash .claude/skills/run-game/scripts/setup.sh
```

Что делает:
- Если pnpm не может создавать симлинки в репозитории (папка смонтирована с Windows →
  `Failed to create symlink ... Operation not permitted`), ставит зависимости в **зеркало**
  `/tmp/dt-run/ws` (rsync исходников, `assets` — симлинк на оригинал). Иначе — `pnpm install` на месте.
- Ставит Playwright + Chromium в `/tmp/dt-run/pw` (браузера в песочнице нет, `chromium-cli` тоже).
- Печатает `WORKSPACE=<путь>` — откуда реально запускается клиент.

## 2. Старт dev server

```bash
bash .claude/skills/run-game/scripts/start.sh
```

Каждый раз заново синхронизирует исходники в зеркало (правки в репо иначе не видны: вотчер
Vite не получает событий с Windows-монтирования), гасит старый процесс на :5173,
запускает `vite` в фоне (лог — `/tmp/dt-run/vite.log`) и ждёт, пока порт ответит.

Остановка: `bash .claude/skills/run-game/scripts/stop.sh` (убивает слушателя порта; **не** используй
`pkill -f vite` — шаблон совпадает с командной строкой агента и убивает сессию).

## 3. Взаимодействие + скриншот

```bash
node /tmp/dt-run/pw/shot.mjs <scratchpad>/shot.png                         # просто кадр
node /tmp/dt-run/pw/shot.mjs <scratchpad>/shot.png ArrowRight ArrowRight   # с нажатиями клавиш
```

`<scratchpad>` — scratchpad-директория текущей сессии: сохраняй скриншоты туда, а не в
`/tmp/dt-run` — читать файлы вне рабочих директорий агенту может быть запрещено.

Шаги после пути — клавиши и действия: `hold:KeyD:600`, `click:x,y`, `rclick:x,y`,
`drag:x1,y1:x2,y2`, `clicktext:Текст` (клик по Phaser-надписи/кнопке), `wait:ms`,
`shot:<путь>` (промежуточный кадр), `dialog:<ответ>` (для `window.prompt`). Полный список — в
шапке `scripts/shot.mjs`. Пример — пройти меню, побегать и открыть редактор:

```bash
node /tmp/dt-run/pw/shot.mjs <scratchpad>/game.png \
  "clicktext:Играть (демо)" hold:KeyD:700 hold:KeyS:500 shot:<scratchpad>/walk.png \
  Escape "clicktext:Редактор комнат"
```

`clicktext` находит кнопку через `window.__game` — его выставляет `main.ts` только в dev-режиме.

Скрипт ждёт, пока Phaser отрисует канвас, выполняет шаги, делает скриншот и печатает ошибки консоли / упавшие запросы. Код выхода ≠ 0, если
были `pageerror`, 4xx/5xx на ассеты или кадр почти однотонный (= ничего не отрисовалось).

**Обязательно открой PNG через Read и посмотри на него.**

## Подводные камни

- WebGL в headless идёт через SwiftShader; предупреждения `GPU stall due to ReadPixels` — норма.
- Ассеты отдаются из корневой `assets/` через `publicDir`; пути с пробелами (`character and tileset/…`)
  — нормально, 404 на них значит, что сломан `publicDir` или имя файла.
- Чтобы пользователь открыл игру в своём браузере: сервер слушает `0.0.0.0:5173`, на хосте нужно
  `sbx ports $SANDBOX_NAME --publish 5173:5173`, затем http://localhost:5173.
