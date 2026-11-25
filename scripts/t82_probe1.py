"""Task 82: пиксельная проверка кадров отладочной краски (t82_probe1).

Кадры close_on / close_off / close_paint сняты с одной камеры (6.7 м
от борта, корабль заморожен) — попиксельно сравнимы. Считает:
  • сколько пикселей изменилось между «шейдер включён» и «выключен»;
  • сколько зелёных пикселей в кадре с отладочным вельсом (положение
    и толщина пояса в пикселях);
  • вертикальный профиль RGB по столбцу в середине борта.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

d = Path(sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/scripts/shots/t82_probe')
ims = {}
for n in ('close_on', 'close_off', 'close_paint'):
    f = d / f'{n}.png'
    if f.exists():
        ims[n] = np.asarray(Image.open(f).convert('RGB')).astype(np.int16)
if not ims:
    sys.exit('нет кадров close_*.png — сначала node scripts/t82_probe1.mjs')
on = ims['close_on']
H, W, _ = on.shape
print('size', W, H)

if 'close_off' in ims:
    off = ims['close_off']
    diff = np.abs(on - off).sum(axis=2)
    # корпус: «дерево» в выключенном кадре (коричневый, не вода)
    brown = (off[:, :, 0] > off[:, :, 2] + 10) & (off.sum(axis=2) < 420) & (off.sum(axis=2) > 40)
    ys, xs = np.where(brown)
    print(f'hull(wood) px: {brown.sum()}; bbox x {xs.min()}..{xs.max()} y {ys.min()}..{ys.max()}')
    ch = (diff > 12) & brown
    print(f'changed px inside wood: {ch.sum()} ({100 * ch.sum() / max(1, brown.sum()):.1f}%); mean |diff| inside wood: {diff[brown].mean():.1f}')
    print('mean RGB on-hull (on):', on[brown].mean(axis=0).round(1), ' (off):', off[brown].mean(axis=0).round(1))

if 'close_paint' in ims:
    p = ims['close_paint']
    g = (p[:, :, 1] > p[:, :, 0] + 40) & (p[:, :, 1] > p[:, :, 2] + 40)
    ys, xs = np.where(g)
    if len(ys):
        # толщина пояса — по столбцам
        cnt = np.bincount(xs, minlength=W)
        cnt = cnt[cnt > 0]
        print(f'green (wale) px: {len(ys)}; bbox x {xs.min()}..{xs.max()} y {ys.min()}..{ys.max()}; '
              f'columns with green {len(cnt)}; thickness median {np.median(cnt):.0f}px, p10 {np.percentile(cnt, 10):.0f}, p90 {np.percentile(cnt, 90):.0f}')
    else:
        print('green px: 0 — вельс не виден')

# вертикальный профиль: столбец с максимумом «дерева»
colsum = brown.sum(axis=0)
x = int(np.argmax(np.convolve(colsum, np.ones(41) / 41, mode='same')))
col = on[:, x]
rows = np.where(brown[:, x])[0]
print('profile column x =', x, 'wood rows', rows.min() if len(rows) else None, '..', rows.max() if len(rows) else None)
if len(rows):
    y0, y1 = rows.min(), rows.max()
    dark = 0
    for y in range(y0 + 1, y1):
        if col[y].sum() < col[y - 1].sum() - 18 and col[y].sum() < col[y + 1].sum() - 18 and col[y].sum() < 0.72 * (col[y - 1].sum() + col[y + 1].sum()) / 2:
            dark += 1
    print(f'dark horizontal lines (seams) in column: {dark} over {y1 - y0 + 1}px')
    step = max(1, (y1 - y0) // 70)
    print('   y |   on RGB        |   off RGB      |  paint RGB')
    for y in range(y0, y1 + 1, step):
        c = {n: tuple(int(v) for v in ims[n][y, x]) for n in ims}
        print(f'{y:5d} | {str(c.get("close_on")):15s}| {str(c.get("close_off")):15s}| {str(c.get("close_paint"))}')
