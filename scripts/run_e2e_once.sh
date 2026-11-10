#!/bin/bash
# Одноразовый прогон e2e: старт dev-сервера + тест + остановка сервера.
# Всё в одном вызове, т.к. песочница убивает процессы на порту 3000 между вызовами.
set -u
cd /home/z/my-project

# 1) убить остатки
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null
sleep 2

# 2) стартовать dev-сервер отсоединённо
setsid nohup npm run dev > /tmp/devserver.log 2>&1 < /dev/null &
disown

# 3) дождаться готовности (до 90 сек)
ready=""
for i in $(seq 1 45); do
  code=$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null)
  if [ "$code" = "200" ]; then ready="yes"; break; fi
  sleep 2
done
if [ "$ready" != "yes" ]; then
  echo "SERVER FAILED TO START (last code: $code)"
  tail -20 /tmp/devserver.log
  exit 2
fi
echo "SERVER READY (${i}x2s)"

# 4) прогнать e2e с жёстким лимитом
TEST="${1:-scripts/e2e_v56.mjs}"
timeout --signal=KILL "${2:-480}" node "$TEST" > /tmp/e2e_run.log 2>&1
rc=$?

# 5) остановить сервер
pkill -f "next dev" 2>/dev/null; pkill -f "next-server" 2>/dev/null

echo "=== TEST EXIT CODE: $rc ==="
tail -40 /tmp/e2e_run.log
