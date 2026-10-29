#!/bin/bash
# Самодостаточный прогон E2E: песочница убивает фоновые процессы после
# завершения Bash-вызова, поэтому сервер и тест живут в ОДНОМ вызове.
# Использование: bash scripts/serve_test.sh scripts/e2e_vXX.mjs [timeout_ms]
set -u
TEST="${1:?укажите тест-скрипт}"
TMO="${2:-540000}"
cd /home/z/my-project

# прибить возможный остаток и запустить сервер
pkill -f "next dev" 2>/dev/null
sleep 1
npx next dev -p 3000 > dev.log 2>&1 &
SRV=$!

# ждать готовности (до 90 с)
for i in $(seq 1 45); do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 5 http://localhost:3000 2>/dev/null)
  if [ "$code" = "200" ]; then echo "SERVER READY (try $i)"; break; fi
  sleep 2
done
if [ "$code" != "200" ]; then echo "SERVER FAILED"; tail -20 dev.log; kill $SRV 2>/dev/null; exit 2; fi

# прогон теста
timeout --signal=SIGTERM $((${TMO}/1000 - 60)) node "$TEST"
RC=$?

# подчистить за собой
pkill -f "next dev" 2>/dev/null
kill $SRV 2>/dev/null
echo "TEST RC=$RC"
exit $RC
