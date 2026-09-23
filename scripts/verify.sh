#!/bin/sh
# Проверка запуска из чистого клона (п. 5.4.16): install → build → start → страница → демо-анализ → заключение → eval без ключа.
# Использование: bun run verify
set -e
# Основной сценарий проверяется без ключа: тестовый комплект отвечает из закоммиченного кэша.
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
  case "$code" in 200|30*) echo "✅ ЗАПУСКАЕТСЯ ИЗ ЧИСТОГО КЛОНА (HTTP $code)"; break;; esac
  i=$((i+1))
done
[ $i -ge 45 ] && { echo "❌ НЕ ПОДНЯЛСЯ за 45с. Лог:"; tail -30 "$TMP/start.log"; exit 1; }

echo "-> страница анализа и демо-анализ через API (без ключа — из кэша data/cache)"
[ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/dashboard/orgdiff)" = 200 ] || { echo "❌ /dashboard/orgdiff не отвечает"; exit 1; }
JOB=$(curl -s -X POST "http://localhost:$PORT/api/analyze?demo=1" | sed -n 's/.*"jobId":"\([^"]*\)".*/\1/p')
n=0
while [ $n -lt 60 ]; do
  curl -s "http://localhost:$PORT/api/analyze/$JOB" -o "$TMP/job.json"
  grep -q '"status":"done"' "$TMP/job.json" && break
  grep -q '"status":"error"' "$TMP/job.json" && { echo "❌ анализ упал:"; head -c 500 "$TMP/job.json"; exit 1; }
  sleep 1; n=$((n+1))
done
grep -q '"findings":\[{' "$TMP/job.json" || { echo "❌ демо-анализ не дал выводов"; exit 1; }
echo "✅ демо-анализ: готово за ${n}с"
[ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/api/analyze/$JOB/report")" = 200 ] || { echo "❌ заключение не выгружается"; exit 1; }
echo "✅ заключение .docx выгружается"

echo "-> bun run eval без ключа (эталон + контрольный комплект из кэша)"
OPENAI_API_KEY= bun run eval > "$TMP/eval.log" 2>&1 || { tail -20 "$TMP/eval.log"; echo "❌ eval не прошёл"; exit 1; }
tail -3 "$TMP/eval.log"
