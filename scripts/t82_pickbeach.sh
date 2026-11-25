#!/usr/bin/env bash
# Task 82: «пипетка» по светлым пятнам на борту — съёмка → поиск
# светло-бежевых кластеров в кадре planks_detail → raycast по их центрам
# (какие меши/доски там видны). Запуск: bash scripts/t82_pickbeach.sh <tag>
set -uo pipefail
cd /home/z/my-project
tag="${1:-pick}"
bash scripts/t82_check.sh "$tag" 2>&1 | grep -E "корабль|errors|console|===|\"\\{" | head -12
B=$(python3 scripts/t82_beach.py scripts/shots/t82_$tag/planks_detail.png 330 640)
echo "$B"
C=$(echo "$B" | awk '/^CENTERS/ { $1=""; print }')
echo "centers: $C"
[ -n "$C" ] && node scripts/t82_pick.mjs $C
