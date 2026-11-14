#!/bin/bash
# Task 51: УБОРКА ПРОЕКТА (по просьбе игрока: «почисти от скриншотов
# и старых файлов»). Образец — прошлая уборка 2026-11-10.
# Удаляем: ВСЕ скриншоты scripts/shots/ (32 МБ), старые логи e2e,
# VLM-выгрузки task50, диагностические пробы (diag_*, dbg_v60),
# одноразовые shots-скрипты task50, скриншоты из download/task50.
# Оставляем: активные e2e v53-v69, run_e2e_once.sh + serve_test.sh,
# sanity_skirt.mjs, gen_palm_glb.mjs, check_palm_glb.mjs, devdaemon.py,
# свежие логи сегодняшнего дня, текстовые артефакты download/.
set -e
cd /home/z/my-project

echo "=== ДО: $(du -sh scripts | cut -f1), git tracked: $(git ls-files scripts | wc -l) файлов"

# 1) скриншоты: из git и с диска
git rm -rq scripts/shots 2>/dev/null || rm -rf scripts/shots
mkdir -p scripts/shots   # e2e-сюиты пишут сюда скриншоты при прогоне
touch scripts/shots/.gitkeep

# 2) старые логи: из git; локально оставляем только сегодняшние (restore) + task50-архив уже в download
git rm -rq --cached scripts/logs 2>/dev/null || true
find scripts/logs -type f ! -name "*_2026-11-14.txt" -delete 2>/dev/null || true

# 3) VLM-выгрузки task50 (результаты в worklog) и одноразовые диагностические пробы
rm -f scripts/vlm_t50_*.json
rm -f scripts/diag_t47.mjs scripts/diag_t48.mjs scripts/diag_t48b.mjs scripts/diag_t48c.mjs
rm -f scripts/diag_stairs.mjs scripts/dbg_v60.mjs
rm -f scripts/shots_t50.mjs scripts/shots_t50b.mjs scripts/shots_t50c.mjs scripts/shots_t50d.mjs
git rm -q scripts/vlm_t50_*.json 2>/dev/null || true
git rm -q scripts/diag_t47.mjs scripts/diag_t48.mjs scripts/diag_t48b.mjs scripts/diag_t48c.mjs 2>/dev/null || true
git rm -q scripts/diag_stairs.mjs scripts/dbg_v60.mjs 2>/dev/null || true
git rm -q scripts/shots_t50.mjs scripts/shots_t50b.mjs scripts/shots_t50c.mjs scripts/shots_t50d.mjs 2>/dev/null || true

# 4) скриншоты из download (текстовые артефакты остаются)
git rm -q download/task50/*.png 2>/dev/null || true

# 5) .gitignore: скриншоты и логи больше не мусорят репозиторий
grep -q "scripts/shots" .gitignore || cat >> .gitignore <<'EOF'

# Task 51: скриншоты и логи прогонов — локальные артефакты, не для git
scripts/shots/*
!scripts/shots/.gitkeep
scripts/logs/
EOF

echo "=== ПОСЛЕ: $(du -sh scripts | cut -f1), git tracked: $(git ls-files scripts | wc -l) файлов"
echo "=== shots/: $(ls scripts/shots | wc -l) файлов, logs/: $(ls scripts/logs | wc -l) файлов"
echo "=== download/task50: $(ls download/task50)"
