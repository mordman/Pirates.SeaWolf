#!/usr/bin/env bash
# Task 82: разбор «аменда песочницы».
# Платформа z.ai раз в несколько часов втискивает рабочее дерево в
# ПОСЛЕДНИЙ коммит через amend (сообщение не меняется). Из-за этого
# коммит «Task 81» был поглощён amend'ом коммита «docs: AGENTS.md»:
# история разошлась с origin/main (non-fast-forward), в дерево попали
# 902 посторонних файла skills/ и сбитые права (755).
#
# Скрипт собирает ПОВЕРХ origin/main отдельный коммит с теми же блобами
# не-skills правок (режимы файлов — как в origin/main; skills/ не
# трогается), переносит main на него (старый HEAD сохраняется веткой
# backup/sandbox-snapshot) и возвращает права на диске.
# Никакого force-pushа: для remote это обычный fast-forward.
#
# Запуск: bash scripts/git_reconcile.sh <файл сообщения коммита>
set -euo pipefail
cd /home/z/my-project
# права на диске — как в индексе (платформа ставит всем файлам 755)
fix_modes() {
  local n=0 rec meta p
  while IFS= read -r -d '' rec; do
    meta=${rec%%$'\t'*}; p=${rec#*$'\t'}
    if [ "${meta%% *}" = "100644" ] && [ -e "$p" ] && [ -x "$p" ]; then chmod -x "$p"; n=$((n + 1)); fi
  done < <(git ls-files -s -z)
  echo "— восстановлено прав (755 → 644): $n"
}
if [ "${1:-}" = "--fix-modes" ]; then fix_modes; git status --short | head; exit 0; fi
MSG="${1:?укажите путь к файлу сообщения коммита}"
OLD=$(git rev-parse HEAD)
BASE=$(git rev-parse origin/main)
[ "$OLD" != "$BASE" ] || { echo "HEAD уже совпадает с origin/main"; exit 0; }
IDX=.git/index-reconcile
rm -f "$IDX"
export GIT_INDEX_FILE="$IDX"
git read-tree "$BASE"
echo "— переносятся не-skills правки из $(git rev-parse --short "$OLD") поверх $(git rev-parse --short "$BASE"):"
git diff --name-only --no-renames -z "$BASE" "$OLD" -- . ':!skills' | while IFS= read -r -d '' p; do
  om=$(git ls-tree "$BASE" -- "$p" | awk '{print $1}')
  ob=$(git rev-parse -q --verify "$BASE:$p" 2>/dev/null || true)
  nb=$(git rev-parse -q --verify "$OLD:$p" 2>/dev/null || true)
  if [ -z "$nb" ]; then git update-index --force-remove -- "$p"; echo "  - $p"; continue; fi
  [ "$ob" = "$nb" ] && continue            # содержимое то же — отличался только режим
  mode="$om"
  [ -z "$mode" ] && case "$p" in scripts/*.mjs|scripts/*.py|scripts/*.sh) mode=100755;; *) mode=100644;; esac
  git update-index --add --cacheinfo "$mode,$nb,$p"
  echo "  + $p ($mode)"
done
# дополнительные пути из РАБОЧЕГО дерева (правки, сделанные после
# последнего аменда платформы) — в тот же коммит; режим с диска
for p in "${@:2}"; do git update-index --add -- "$p"; echo "  + $p (рабочее дерево)"; done
TREE=$(git write-tree)
NEW=$(git commit-tree "$TREE" -p "$BASE" -F "$MSG")
unset GIT_INDEX_FILE
rm -f "$IDX"
git branch -f backup/sandbox-snapshot "$OLD" >/dev/null
git update-ref -m "reconcile: правки песочницы отдельным коммитом поверх origin/main" refs/heads/main "$NEW" "$OLD"
git reset -q
fix_modes
echo "— новый HEAD: $(git log --oneline -1 | cut -c1-90)"
echo "— родитель:  $(git rev-parse --short "$BASE") (origin/main); запасная ветка: backup/sandbox-snapshot → $(git rev-parse --short "$OLD")"
echo "— строк в git status: $(git status --short | wc -l)"
echo "— skills: в HEAD $(git ls-tree -r --name-only HEAD -- skills | wc -l), в origin/main $(git ls-tree -r --name-only origin/main -- skills | wc -l), на диске $(find skills -type f | wc -l)"
git diff --stat "$BASE" HEAD | tail -1
