#!/usr/bin/env bash
# Гасит процессы, слушающие порты dev server клиента и игрового сервера.
lsof -ti:5173 -sTCP:LISTEN | xargs -r kill
lsof -ti:2567 -sTCP:LISTEN | xargs -r kill
exit 0
