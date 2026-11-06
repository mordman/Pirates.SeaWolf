#!/usr/bin/env python3
# Помощник e2e: доля белёсых (пенных) пикселей в нижних 2/3 кадра
import sys
from PIL import Image

def stats(path):
    img = Image.open(path).convert('RGB')
    w, h = img.size
    px = img.load()
    total = 0; whitish = 0
    for y in range(h // 3, h, 2):
        for x in range(w // 8, w - w // 8, 2):
            r, g, b = px[x, y]
            lum = 0.3 * r + 0.55 * g + 0.15 * b
            mx, mn = max(r, g, b), min(r, g, b)
            sat = (mx - mn) / mx if mx else 0
            total += 1
            if lum > 150 and sat < 0.22:
                whitish += 1
    print(f"{100 * whitish / total:.1f}")

stats(sys.argv[1])
