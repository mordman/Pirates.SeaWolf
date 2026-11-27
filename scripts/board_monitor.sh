#!/bin/bash
# Task 85: монитор полного цикла абордажа — старт игры, forceBoarding,
# poll телеметрии каждые 5 с до исхода. Использование:
#   bash scripts/board_monitor.sh [индекс_ИИ] [макс_сек]
IDX=${1:-1}
MAXS=${2:-90}
cd /home/z/my-project

agent-browser eval "window.__game && window.__game.started || window.__game.start()" >/dev/null 2>&1
sleep 3
agent-browser eval "(() => { const b = [...document.querySelectorAll('button')].find(x => /Позже|Готово/.test(x.textContent)); if (b) b.click(); return 1; })()" >/dev/null 2>&1
sleep 2
echo "forceBoarding($IDX): $(agent-browser eval "JSON.stringify(window.__game.forceBoarding($IDX))" 2>&1 | tail -1)"

T0=$(date +%s)
while true; do
  NOW=$(date +%s); EL=$((NOW - T0))
  if [ "$EL" -gt "$MAXS" ]; then echo "TIMEOUT after ${MAXS}s"; break; fi
  OUT=$(agent-browser eval "(() => { const b = window.__game.boardingInfo(); if (!b) return JSON.stringify({none: true, dead: window.__game.dead, started: window.__game.started, fps: Math.round(window.__game.fpsSmooth)}); return JSON.stringify({phase: b.phase, res: b.result, dist: b.lashDist, planks: b.planksDown + '/' + b.planks, fA: b.fightersA, fD: b.fightersD, eng: b.engaged, cA: b.crewA, cD: b.crewD, t: b.fightT, surr: b.defenderSurrendered, fps: Math.round(window.__game.fpsSmooth)}); })()" 2>&1 | tail -1)
  echo "t+${EL}s $OUT"
  case "$OUT" in
    *'"none": true'*) echo "BOARDING ENDED"; break ;;
  esac
  sleep 5
done
