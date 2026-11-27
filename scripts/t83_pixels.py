#!/usr/bin/env python3
# Task 83: замер фактических цветов пикселей на крупных планах
# «Чёрной жемчужины» — планширь, перила квартердека, настил, борт.
from PIL import Image
import sys

# кадры 1280x720 (или как отдаёт agent-browser); берём центральные полосы
SHOTS = "/home/z/my-project/scripts/shots"

def sample(path, label, regions):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    out = []
    for name, (x0, y0, x1, y1) in regions:  # доли кадра
        box = im.crop((int(w * x0), int(h * y0), int(w * x1), int(h * y1)))
        px = list(box.getdata())
        n = len(px)
        r = sum(p[0] for p in px) / n
        g = sum(p[1] for p in px) / n
        b = sum(p[2] for p in px) / n
        lum = 0.3 * r + 0.5 * g + 0.2 * b
        out.append(f"  {name:22s} RGB=({r:5.0f},{g:5.0f},{b:5.0f})  lum={lum:5.0f}")
    print(f"{label} ({w}x{h}):")
    print("\n".join(out))

# qd_deck: вид сверху-сбоку на квартердек — настил в центре, перила по краям
sample(f"{SHOTS}/t83_qd_deck.png", "КВАРТЕРДЕК (настил)",
       [("настил центр", (0.35, 0.45, 0.65, 0.75)),
        ("перила верх-лево", (0.05, 0.05, 0.30, 0.20)),
        ("перила верх-право", (0.70, 0.05, 0.95, 0.20))])
# qd_rail: перила квартердека крупно
sample(f"{SHOTS}/t83_qd_rail.png", "ПЕРИЛА КВАРТЕРДЕКА",
       [("перила центр", (0.30, 0.35, 0.70, 0.65)),
        ("фон-море", (0.05, 0.80, 0.30, 0.95))])
# rail_cap: планширь главной палубы
sample(f"{SHOTS}/t83_rail_cap.png", "ПЛАНШИРЬ (гл. палуба)",
       [("планширь центр", (0.30, 0.35, 0.70, 0.65)),
        ("борт ниже", (0.30, 0.70, 0.70, 0.90))])
# hull_side: чистый борт
sample(f"{SHOTS}/t83_hull_side.png", "БОРТ",
       [("борт центр", (0.30, 0.35, 0.70, 0.65)),
        ("верхняя полоса", (0.30, 0.10, 0.70, 0.25))])
