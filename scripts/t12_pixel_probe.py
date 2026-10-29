#!/usr/bin/env python3
"""Замер яркости транца (кормы) на скриншотах: не выглядит ли он чёрной дырой."""
from PIL import Image
import sys

def probe(path, label):
    img = Image.open(path).convert('RGB')
    w, h = img.size
    # центр кадра чуть ниже середины — там транец
    regions = {
        'center (transom)': (w//2, int(h*0.58), 40),
        'lower center': (w//2, int(h*0.70), 40),
        'sky top': (w//2, int(h*0.10), 40),
        'water bottom': (w//2, int(h*0.90), 40),
    }
    print(f'--- {label} ({path}) {w}x{h}')
    for name, (cx, cy, r) in regions.items():
        rs, gs, bs, n = 0, 0, 0, 0
        for x in range(max(0, cx-r), min(w, cx+r)):
            for y in range(max(0, cy-r), min(h, cy+r)):
                px = img.getpixel((x, y))
                rs += px[0]; gs += px[1]; bs += px[2]; n += 1
        print(f'  {name:20s} RGB=({rs//n:3d},{gs//n:3d},{bs//n:3d})  lum={int(0.3*rs/n+0.59*gs/n+0.11*bs/n):3d}')

for p, l in [
    ('scripts/shots/t12_fluyt_stern.png', 'Корма флейта'),
    ('scripts/shots/t12_stern3.png', 'Корма шлюпа'),
]:
    probe(p, l)
