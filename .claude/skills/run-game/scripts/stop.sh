#!/usr/bin/env bash
# Гасит процесс, слушающий порт dev server.
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
exit 0
