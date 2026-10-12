"""Draw the app icons from the colour tokens in css/app.css.

Run: python3 tools/make-icons.py  (needs Pillow)
"""
from pathlib import Path
from PIL import Image, ImageDraw

ACCENT = "#2f7d4f"   # --accent
BOWL = "#f6f7f4"     # --bg
TRACK = "#dfe4df"    # --line
RICE = "#f3e3bf"
SS = 4               # supersampling factor
OUT = Path(__file__).resolve().parent.parent / "icons"


def draw(size, scale):
    s = size * SS
    img = Image.new("RGB", (s, s), ACCENT)
    d = ImageDraw.Draw(img)
    # Artwork is laid out on a 512 grid, spanning y 144..430; centre it.
    k = s / 512 * scale
    ox = s / 2 - 256 * k
    oy = s / 2 - 287 * k

    def p(*xy):
        return [ox + v * k if i % 2 == 0 else oy + v * k for i, v in enumerate(xy)]

    d.ellipse(p(124, 144, 388, 328), fill=RICE)                      # rice mound
    d.rounded_rectangle(p(78, 218, 434, 272), 27 * k, fill=ACCENT)   # gap around rim
    d.pieslice(p(104, 136, 408, 408), 0, 180, fill=BOWL)             # bowl body
    d.rounded_rectangle(p(196, 396, 316, 430), 12 * k, fill=BOWL)    # foot
    d.rounded_rectangle(p(88, 228, 424, 262), 17 * k, fill=BOWL)     # rim
    d.rounded_rectangle(p(176, 312, 336, 332), 10 * k, fill=TRACK)   # progress track
    d.rounded_rectangle(p(176, 312, 284, 332), 10 * k, fill=ACCENT)  # progress fill
    return img.resize((size, size), Image.LANCZOS)


draw(192, 1.0).save(OUT / "icon-192.png", optimize=True)
draw(512, 1.0).save(OUT / "icon-512.png", optimize=True)
# Maskable icons must keep artwork inside the central 80% circle.
draw(512, 0.9).save(OUT / "icon-maskable-512.png", optimize=True)
