#!/usr/bin/env python3
"""Draw the IPTV Player icons (original artwork): icon.png 80x80, largeIcon.png 130x130, docs/icon-512.png."""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'app', 'com.homebrew.iptv')


def star(d, cx, cy, r, fill):
    import math
    pts = []
    for k in range(10):
        a = -math.pi / 2 + k * math.pi / 5
        rr = r if k % 2 == 0 else r * 0.42
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    d.polygon(pts, fill=fill)


def draw(size):
    """Philippine flag colours: royal blue over red, white TV, golden-yellow play button and three stars."""
    S = size * 4
    BLUE, RED, YELLOW, NAVY = (0, 56, 168), (206, 17, 38), (252, 209, 22), (6, 22, 60)
    im = Image.new('RGB', (S, S), BLUE)
    d = ImageDraw.Draw(im)
    d.rectangle([0, S // 2, S, S], fill=RED)
    # antenna
    cx = S / 2
    d.line([(cx, S * 0.30), (cx - S * 0.13, S * 0.12)], fill=(255, 255, 255), width=int(S * 0.03))
    d.line([(cx, S * 0.30), (cx + S * 0.13, S * 0.12)], fill=(255, 255, 255), width=int(S * 0.03))
    # TV
    d.rounded_rectangle([S * 0.13, S * 0.29, S * 0.87, S * 0.81], radius=S * 0.08, fill=(255, 255, 255))
    d.rounded_rectangle([S * 0.19, S * 0.35, S * 0.81, S * 0.75], radius=S * 0.05, fill=NAVY)
    # yellow play button and the flag's three stars
    d.polygon([(S * 0.44, S * 0.43), (S * 0.44, S * 0.67), (S * 0.63, S * 0.55)], fill=YELLOW)
    for x, y in ((0.27, 0.43), (0.27, 0.67), (0.73, 0.55)):
        star(d, S * x, S * y, S * 0.045, YELLOW)
    d.rounded_rectangle([S * 0.38, S * 0.83, S * 0.62, S * 0.87], radius=S * 0.02, fill=(255, 255, 255))
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=S * 0.2, fill=255)
    bg = Image.new('RGB', (S, S), NAVY); bg.paste(im, (0, 0), mask)
    return bg.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    draw(80).save(os.path.join(OUT, 'icon.png'))
    draw(130).save(os.path.join(OUT, 'largeIcon.png'))
    os.makedirs(os.path.join(ROOT, 'docs'), exist_ok=True)
    draw(512).save(os.path.join(ROOT, 'docs', 'icon-512.png'))
    print('icons written')
