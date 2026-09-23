#!/bin/sh
# П. 5.4.16: если проект не запускается по инструкциям из репозитория — команда не допускается
# к отбору, исправления не принимаются. Этот скрипт проверяет запуск ИЗ ЧИСТОГО КЛОНА,
# а не из твоей рабочей папки, где всё уже стоит и переменные давно в окружении.
# Запусти минимум за час до 18:00. Использование: bun run verify
set -e
PORT=${PORT:-3999}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; kill $PID 2>/dev/null || true' EXIT

echo "-> клонирую HEAD в чистую папку"
git clone -q . "$TMP/app"
cd "$TMP/app"

echo "-> bun install (как в README)"
bun install --silent

[ -f env.example.txt ] && cp env.example.txt .env.local 2>/dev/null || true

echo "-> bun run build"
bun run build

echo "-> поднимаю прод-сборку на порту ${PORT}"
PORT=$PORT bun run start > "$TMP/start.log" 2>&1 &
PID=$!

i=0
while [ $i -lt 45 ]; do
  sleep 1
  code=$(curl -s -o /dev/null -w '%{http_code}' -L "http://localhost:$PORT" 2>/dev/null || echo 000)
  case "$code" in 200|30*) echo "✅ ЗАПУСКАЕТСЯ ИЗ ЧИСТОГО КЛОНА (HTTP $code)"; exit 0;; esac
  i=$((i+1))
done

echo "❌ НЕ ПОДНЯЛСЯ за 45с. Лог:"; tail -30 "$TMP/start.log"; exit 1
