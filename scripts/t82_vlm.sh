#!/usr/bin/env bash
# Task 82: разбор кадра VLM-моделью (в этой сессии модель не видит
# картинки — «глаза» заменяет z-ai vision). Ответ пишется в <out.txt>.
# Запуск: bash scripts/t82_vlm.sh <png|jpg> <out.txt> <файл промпта>
set -uo pipefail
img="${1:?image}"; out="${2:?out}"; pf="${3:?prompt file}"
mkdir -p "$(dirname "$out")"
for i in 1 2 3; do
  z-ai vision -p "$(cat "$pf")" -i "$img" > "$out.raw" 2>&1
  if grep -q '"content"' "$out.raw"; then break; fi
  sleep 8
done
python3 - "$out.raw" "$out" <<'PY'
import json, sys
raw = open(sys.argv[1]).read()
try:
    d = json.loads(raw[raw.index('{'):])
    txt = d['choices'][0]['message']['content']
except Exception:
    txt = raw
open(sys.argv[2], 'w').write(txt)
print(txt)
PY
