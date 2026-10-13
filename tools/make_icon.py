"""Draws the program's icon: a chi-rho, the first two letters of "Christ" in Greek,
one of the oldest Christian monograms. Writes build/icon.png and build/icon.ico.

    python tools/make_icon.py        (needs Pillow)
"""
from pathlib import Path

from PIL import Image, ImageDraw

S = 2048                                    # drawn large, then reduced, for smooth edges
GROUND, MARK = (112, 28, 40), (246, 232, 196)
W = 150                                     # stroke width


def line(d, a, b):
    d.line([a, b], fill=MARK, width=W)
    for x, y in (a, b):                     # rounded ends
        d.ellipse([x - W / 2, y - W / 2, x + W / 2, y + W / 2], fill=MARK)


def draw():
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([40, 40, S - 40, S - 40], radius=380, fill=GROUND)
    cx = S / 2
    line(d, (cx, 400), (cx, 1700))                                   # the stem of the rho
    d.arc([cx - 400, 330, cx + 400, 930], start=-90, end=90, fill=MARK, width=W)   # its bowl
    line(d, (560, 900), (S - 560, 1620))                             # the chi
    line(d, (S - 560, 900), (560, 1620))
    return im


def main():
    out = Path(__file__).resolve().parents[1] / "build"
    out.mkdir(exist_ok=True)
    big = draw()
    big.resize((512, 512), Image.LANCZOS).save(out / "icon.png")
    big.resize((256, 256), Image.LANCZOS).save(out / "icon.ico", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("wrote build/icon.png and build/icon.ico")


if __name__ == "__main__":
    main()
