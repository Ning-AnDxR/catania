#!/usr/bin/env python
"""画一张程序化的手绘海图，给棋盘当海域底子用。

用法：
    pip install pillow
    python scripts/art-board-sea.py

这是**占位图**：等 raw/board-sea.png（按 prompts/board-sea.txt 生成）放进来、
跑过 art-to-webp.py 之后，这张就会被换成真正的插画。

之所以先画一张，是因为皮肤里已经挂了 board-sea.webp 这一层：文件不存在会报 404，
而且没法立刻看出海图压在棋盘下面是什么效果。程序化的浪纹 + 罗经花虽然不是手绘，
但线条都带抖动、墨色很淡，先顶着用不会突兀。
"""
import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

DEST = pathlib.Path(__file__).resolve().parent.parent / "debug" / "assets"
W, H = 2048, 1152
INK = (58, 82, 88)
GROUND_TOP = (176, 197, 199)
GROUND_BOTTOM = (140, 166, 171)
MAX_KB = 250

rng = random.Random(20261011)


def ground():
    img = Image.new("RGB", (W, H))
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        row = tuple(round(GROUND_TOP[i] + (GROUND_BOTTOM[i] - GROUND_TOP[i]) * t)
                    for i in range(3))
        for x in range(W):
            px[x, y] = row
    return img


def wave_rows(draw):
    """短促的浪纹，一行一行错开；越靠中间越稀，给棋盘留出干净的地方。"""
    y = 26
    while y < H - 20:
        x = 8
        while x < W - 40:
            # 中段（棋盘会盖住的地方）只留很少几条
            in_middle = 0.22 * W < x < 0.78 * W and 0.18 * H < y < 0.86 * H
            if not in_middle or rng.random() < 0.16:
                length = rng.randint(26, 74)
                alpha = rng.randint(26, 54)
                bow = rng.uniform(-5, 5)
                points = [
                    (x + length * i / 6, y + bow + math.sin(i * 0.9 + x) * 2.4 + rng.uniform(-1, 1))
                    for i in range(7)
                ]
                draw.line(points, fill=(*INK, alpha), width=1 if rng.random() < 0.7 else 2)
            x += rng.randint(34, 78)
        y += rng.randint(15, 27)


def currents(draw):
    for _ in range(7):
        y0 = rng.uniform(40, H - 40)
        amp = rng.uniform(14, 40)
        phase = rng.uniform(0, 6)
        alpha = rng.randint(26, 44)
        points = [
            (x, y0 + math.sin(x / rng.uniform(240, 420) + phase) * amp
             + math.sin(x / 90 + phase * 2) * 4)
            for x in range(0, W + 1, 8)
        ]
        draw.line(points, fill=(*INK, alpha), width=2)


def rhumb_lines(draw):
    cx, cy = W * 0.5, H * 0.42
    for i in range(24):
        angle = i * math.pi / 12 + 0.07
        r = max(W, H) * 1.2
        draw.line(
            (cx, cy, cx + math.cos(angle) * r, cy + math.sin(angle) * r),
            fill=(*INK, 16), width=1,
        )
    for ring in (0.30, 0.42, 0.54):
        r = min(W, H) * ring
        draw.ellipse((cx - r * 1.5, cy - r, cx + r * 1.5, cy + r),
                     outline=(*INK, 12), width=1)


def compass_rose(draw):
    cx, cy, r = 150, H * 0.5, 106
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(*INK, 78), width=2)
    draw.ellipse((cx - r * 0.66, cy - r * 0.66, cx + r * 0.66, cy + r * 0.66),
                 outline=(*INK, 44), width=1)
    for i in range(8):
        angle = i * math.pi / 4
        long = r * (0.96 if i % 2 == 0 else 0.62)
        draw.line((cx + math.cos(angle) * r * 0.2, cy + math.sin(angle) * r * 0.2,
                   cx + math.cos(angle) * long, cy + math.sin(angle) * long),
                  fill=(*INK, 92), width=2)
        half = r * 0.16
        draw.polygon(
            (cx + math.cos(angle) * long, cy + math.sin(angle) * long,
             cx + math.cos(angle + 1.9) * half, cy + math.sin(angle + 1.9) * half,
             cx + math.cos(angle - 1.9) * half, cy + math.sin(angle - 1.9) * half),
            outline=(*INK, 96),
        )
    draw.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), outline=(*INK, 110), width=2)


def main():
    img = ground()
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    rhumb_lines(draw)
    currents(draw)
    wave_rows(draw)
    compass_rose(draw)
    layer = layer.filter(ImageFilter.GaussianBlur(0.5))
    img = Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")

    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / "board-sea.webp"
    for quality in (84, 78, 72, 64, 56):
        img.save(target, "WEBP", quality=quality, method=6)
        if target.stat().st_size <= MAX_KB * 1024:
            break
    print(f"board-sea: {target.name} {W}×{H} "
          f"{round(target.stat().st_size / 1024)}KB")


main()
