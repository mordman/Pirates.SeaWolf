"""Task 82: сборка контактного листа из кадров съёмки.

Использование:
  python3 scripts/t82_sheet.py <out.jpg> <cols> <tile_w> <img1> [<img2> ...]

Каждый кадр уменьшается до tile_w, подписывается именем файла и
склеивается в сетку; итог — JPEG (экономия бюджета изображений:
один лист вместо 4-8 отдельных чтений).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def main() -> None:
    out, cols, tile_w, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
    tiles = []
    for f in files:
        im = Image.open(f).convert('RGB')
        k = tile_w / im.width
        im = im.resize((tile_w, max(1, int(im.height * k))), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        label = Path(f).stem
        try:
            font = ImageFont.truetype(FONT, 15)
        except OSError:
            font = ImageFont.load_default()
        tw = d.textlength(label, font=font)
        d.rectangle([0, 0, tw + 12, 21], fill=(0, 0, 0))
        d.text((6, 2), label, fill=(255, 235, 120), font=font)
        tiles.append(im)
    th = max(t.height for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tile_w, rows * th), (18, 18, 18))
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % cols) * tile_w, (i // cols) * th))
    sheet.save(out, quality=72)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
