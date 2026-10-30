#!/usr/bin/env python3
# Анализ скриншота: вертикальные скан-линии через корпус корабля.
# Цель: понять, что видит VLM — где корпус, где белая полоса, где вода.
import sys
from PIL import Image

path = sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/scripts/shots/v31_calm_check.png'
img = Image.open(path).convert('RGB')
W, H = img.size
print(f'{path}: {W}x{H}')

# классификатор пикселя
def classify(r, g, b):
    if r > 185 and g > 190 and b > 190: return 'WHITE'      # пена/паруса
    if b > r + 18 and b > 90: return 'WATER'                 # море (синева)
    if r > 100 and g > 70 and b < r - 12: return 'HULL'      # дерево корпуса
    if r > 150 and g > 120 and b > 90: return 'DECK'         # палуба светлая
    return 'other'

# сканируем центральную треть по X, ищем колонки с корпусом (HULL) —
# печатаем структуру одной характерной колонки: переходы классов сверху вниз
best = None
for x in range(W // 4, W * 3 // 4, 8):
    runs = []  # (class, y0, y1)
    last = None
    for y in range(H // 8, H - 20):
        c = classify(*img.getpixel((x, y)))
        if c == 'other': c = last[0] if last else 'other'
        if last and last[0] == c:
            last[2] = y
        else:
            if last: runs.append(last)
            last = [c, y, y]
    if last: runs.append(last)
    hull = [r for r in runs if r[0] == 'HULL' and r[2] - r[1] > 12]
    if hull and (best is None or hull[0][2] - hull[0][1] > best[1]):
        best = (x, hull[0][2] - hull[0][1], runs)

if not best:
    print('корпус не найден'); sys.exit(0)
x, hullH, runs = best
print(f'колонка x={x}, высота корпуса {hullH}px')
print('структура сверху вниз (класс: y0..y1, высота):')
for c, y0, y1 in runs:
    h = y1 - y0
    if h < 4: continue
    # средний цвет полосы
    rs = gs = bs = n = 0
    for y in range(y0, y1 + 1, max(1, h // 6)):
        r, g, b = img.getpixel((x, y)); rs += r; gs += g; bs += b; n += 1
    print(f'  {c:6s} y={y0:4d}..{y1:4d} h={h:4d}px  rgb=({rs//n},{gs//n},{bs//n})')
