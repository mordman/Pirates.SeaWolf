#!/usr/bin/env bash
# Task 82: съёмка «после» + проверка консоли + контактные листы.
# Запуск: bash scripts/t82_check.sh <tag> [presetId]
#   кадры: scripts/shots/t82_<tag>/*.png, листы: scripts/shots/t82_<tag>_sheet{A,B}.jpg
#   в конце — ошибки страницы и строки консоли с shader/GLSL/WebGL.
set -uo pipefail
cd /home/z/my-project
tag="${1:?tag}"; preset="${2:-}"
if [ -n "$preset" ]; then node scripts/t82_shots.mjs "$tag" "$preset"; else node scripts/t82_shots.mjs "$tag"; fi
S=scripts/shots/t82_$tag
python3 scripts/t82_sheet.py scripts/shots/t82_${tag}_sheetA.jpg 2 760 $S/side.png $S/bow34.png $S/stern34.png $S/iso.png
python3 scripts/t82_sheet.py scripts/shots/t82_${tag}_sheetB.jpg 2 760 $S/deck.png $S/rig.png $S/top.png $S/planks_detail.png
# Task 82: крупные планы оконечностей и фальшборта (если сняты)
if [ -f "$S/bow_close.png" ]; then
python3 scripts/t82_sheet.py scripts/shots/t82_${tag}_sheetC.jpg 2 760 $S/hull_close.png $S/bow_close.png $S/stern_close.png $S/rail_in.png
fi
echo "=== errors ==="
agent-browser errors 2>&1 | tail -25
echo "=== console (filter) ==="
agent-browser console 2>&1 | grep -i -E "error|shader|glsl|webgl|THREE|warn|exception|fail" | cut -c1-400 | tail -30
echo "=== console lines total: $(agent-browser console 2>&1 | wc -l) ==="
echo "=== render info ==="
agent-browser eval "(() => { const g = window.__game, r = g.renderer.info.render; return JSON.stringify({ calls: r.calls, tris: r.triangles, geoms: g.renderer.info.memory.geometries, progs: g.renderer.info.programs.length, mats: g.renderer.info.memory.textures }); })()" 2>&1 | tail -2
