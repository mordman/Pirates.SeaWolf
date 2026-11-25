"""Task 82: вертикальный профиль цвета по борту (центр корабля):
печатает RGB по строкам кадра от нижней точки корпуса до палубы —
так видно, есть ли на картинке пояса окраски/ватерлиния/пазы.
Использование: python3 scripts/t82_probe2.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

d = Path('/home/z/my-project/scripts/shots/t82_probe')
pr = json.loads((d / 'proj.json').read_text())
print('plankY', pr['plankY'], 'shipY', pr['shipY'], 'draft', pr['draft'], 'sun', pr['sun'], 'cam', pr['cam'])
for k, v in pr['pts'].items():
    print(f'  {k:8s} -> px {v}')

imgs = {n: np.asarray(Image.open(d / f'{n}.png').convert('RGB')).astype(int) for n in ('on', 'off', 'paint', 'side2') if (d / f'{n}.png').exists()}
x = (pr['pts']['wl'][0] + pr['pts']['wale0'][0]) // 2
# ищем столбец с максимумом «дерева» рядом с центром
best = None
for xx in range(x - 120, x + 120, 6):
    col = imgs['on'][:, xx]
    brown = ((col[:, 0] > col[:, 2] + 8) & (col.sum(axis=1) < 330)).sum()
    if best is None or brown > best[0]:
        best = (brown, xx)
x = best[1]
print('column x =', x, 'brown rows', best[0])
col = imgs['on'][:, x]
rows = np.where((col[:, 0] > col[:, 2] + 8) & (col.sum(axis=1) < 360))[0]
if len(rows):
    # самая длинная непрерывная серия
    start = rows[0]; prev = rows[0]; bestseg = (rows[0], rows[0])
    for r in rows[1:]:
        if r != prev + 1:
            if prev - start > bestseg[1] - bestseg[0]:
                bestseg = (start, prev)
            start = r
        prev = r
    if prev - start > bestseg[1] - bestseg[0]:
        bestseg = (start, prev)
    y0, y1 = max(0, bestseg[0] - 12), min(imgs['on'].shape[0] - 1, bestseg[1] + 6)
    print(f'hull column rows {bestseg[0]}..{bestseg[1]} (scan {y0}..{y1}); height {bestseg[1] - bestseg[0] + 1}px')
    print('   y |   on RGB        |   off RGB      |  paint RGB     | side2 RGB')
    for y in range(y0, y1 + 1):
        c = {n: tuple(int(v) for v in imgs[n][y, x]) for n in imgs}
        tag = ''
        for k in ('wl', 'wale0', 'wale1', 'rail0', 'y2', 'y3'):
            if pr['pts'][k][1] == y:
                tag += f' <{k}>'
        print(f'{y:5d} | {str(c.get("on")):15s}| {str(c.get("off")):15s}| {str(c.get("paint")):15s}| {str(c.get("side2"))}{tag}')
