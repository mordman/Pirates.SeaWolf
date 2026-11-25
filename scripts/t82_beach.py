"""Task 82: поиск «светлых прямоугольников» на борту (кадр
planks_detail: камера в 6.7 м, освещённый борт) — связные области
светло-бежевых пикселей (цвет палубы) в полосе корпуса. Печатает
bounding-box'ы (x0,y0,x1,y1, px) — координаты нужны для raycast.

Использование: python3 scripts/t82_beach.py <png> [y0 y1]
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

f = sys.argv[1]
im = np.asarray(Image.open(f).convert('RGB')).astype(int)
y0 = int(sys.argv[2]) if len(sys.argv) > 2 else 0
y1 = int(sys.argv[3]) if len(sys.argv) > 3 else im.shape[0]
R, G, B = im[..., 0], im[..., 1], im[..., 2]
beige = np.zeros(R.shape, bool)
beige[y0:y1] = (R[y0:y1] > 150) & (G[y0:y1] > 120) & (R[y0:y1] - B[y0:y1] > 50) & (G[y0:y1] - B[y0:y1] > 25) & (R[y0:y1] - G[y0:y1] < 60)
lab, n = ndimage.label(beige)
objs = ndimage.find_objects(lab)
out = []
for i, sl in enumerate(objs):
    if sl is None:
        continue
    cnt = int((lab[sl] == i + 1).sum())
    h = sl[0].stop - sl[0].start
    w = sl[1].stop - sl[1].start
    if cnt < 60:
        continue
    fill = cnt / (h * w)
    out.append((cnt, sl[1].start, sl[0].start, sl[1].stop, sl[0].stop, round(fill, 2)))
out.sort(reverse=True)
print('beige clusters (px, x0, y0, x1, y1, fill):')
for o in out[:25]:
    print('  ', o)
print('total beige px', int(beige.sum()), 'clusters', len(out))
# центры крупнейших кластеров — для «пипетки» (t82_pick.mjs)
print('CENTERS', ' '.join(f'{(o[1] + o[3]) // 2},{(o[2] + o[4]) // 2}' for o in out[:6]))
