"""Task 82: вырезка_region из кадра (для VLM-разбора детали в полном
разрешении — контактный лист уменьшает кадры вдвое).

Использование:
  python3 scripts/t82_crop.py <in.png> <out.jpg> x0 y0 x1 y1 [max_width]
"""
import sys

from PIL import Image

src, out = sys.argv[1], sys.argv[2]
x0, y0, x1, y1 = (int(v) for v in sys.argv[3:7])
maxw = int(sys.argv[7]) if len(sys.argv) > 7 else 0
im = Image.open(src).convert('RGB').crop((x0, y0, x1, y1))
if maxw and im.width > maxw:
    im = im.resize((maxw, int(im.height * maxw / im.width)), Image.LANCZOS)
im.save(out, quality=80)
print(out, im.size)
