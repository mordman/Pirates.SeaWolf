#!/usr/bin/env python3
# Скриншот -> ASCII-карта цветов (внизсэмплинг), чтобы видеть структуру кадра.
import sys
from PIL import Image

path = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 110
img = Image.open(path).convert('RGB')
W, H = img.size
rows = max(10, int(cols * H / W * 0.55))
small = img.resize((cols, rows), Image.LANCZOS)

def code(r, g, b):
    # небо/даль: светло-голубое или серое
    if b > 150 and b >= r + 10 and g > 130: return '.'   # небо
    if b > r + 14 and b > 80: return '~'                 # вода
    if r > 200 and g > 205 and b > 205: return 'W'       # пена/белое
    if r > 150 and g > 130 and b > 100 and r > b + 25: return 'D'  # палуба/тёплое светлое
    if r > 90 and g > 55 and b < r - 15: return 'H'      # корпус (дерево)
    if r > 150 and g > 60 and b < 80: return 'O'         # ярко-оранжевое
    if r < 70 and g < 70 and b < 70: return 'K'          # тёмное (такелаж/дыры)
    return '-'

for y in range(rows):
    line = ''
    for x in range(cols):
        line += code(*small.getpixel((x, y)))
    print(f'{y:3d} {line}')
