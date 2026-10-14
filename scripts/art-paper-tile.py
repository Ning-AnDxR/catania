#!/usr/bin/env python
"""生成一张无缝的羊皮纸纹理砖，给首页面板当底。

用法：
    pip install pillow
    python scripts/art-paper-tile.py

为什么程序化生成而不是画一张：这是**平铺**底纹，不是插画。羊皮纸的手感来自三层
东西 —— 2px 尺度的颗粒（纸浆纤维）、1~2px 的短须（纤维走向）、以及很低频的淡斑
（陈化）。幅度都压在 ±6/255 以内，不然一铺开就抢正文的可读性。

无缝做法：先画 128×128，再镜像拼成 256×256。镜像保证接缝像素连续，不会出现网格线；
代价是纹理带一点对称，在这个幅度下看不出来。

必须用 lossless：逐像素级别的颗粒是有损压缩第一个抹掉的东西，实测存成有损 webp 后
高频细节只剩 0.01，整张砖变成一块平滑渐变。所以这里走 lossless，靠"特征只在 2px
以上"来控制体积。
"""
import math
import pathlib
import random

from PIL import Image, ImageDraw, ImageFilter

DEST = pathlib.Path(__file__).resolve().parent.parent / "debug" / "assets"
TILE = 256
HALF = TILE // 2
BASE = (230, 223, 202)          # 比 --paper 稍暖稍沉，压掉发白
FIBRE_DARK = (218, 209, 186)
FIBRE_LIGHT = (240, 234, 216)
FIBRE = (212, 202, 178)
MAX_KB = 40

rng = random.Random(20261013)


def blotch_layer(size, cells, amplitude):
    """先把低频噪声做得很小再放大，就得到柔和的大块斑。"""
    small = Image.new("L", (cells, cells))
    px = small.load()
    for y in range(cells):
        for x in range(cells):
            px[x, y] = max(0, min(255, round(128 + rng.gauss(0, 60))))
    big = small.resize((size, size), Image.BICUBIC)
    return big.point(lambda v: 128 + round((v - 128) * amplitude / 60))


def main():
    base = Image.new("RGB", (HALF, HALF), BASE)
    # 低频陈化 + 中频起伏。陈化压得比较低：斑块一大就容易看成"水渍"，
    # 而真正像纸的是下面那些 2px 颗粒。参照物是背景海图自己的羊皮纸，
    # 实测标准差 2.39、细节 0.05 —— 纸面本来就平，靠的就是细颗粒不是大斑。
    aged = blotch_layer(HALF, 12, 2.2).point(lambda v: v - 128)
    pulp = blotch_layer(HALF, 34, 3.4).point(lambda v: v - 128)
    px = base.load()
    ap, pp = aged.load(), pulp.load()
    for y in range(HALF):
        for x in range(HALF):
            d = ap[x, y] + pp[x, y]
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + d)),
                        max(0, min(255, g + d)),
                        max(0, min(255, b + d)))

    # 颗粒：2×2 的小块，明暗两种，这才是"纸浆感"的来源
    draw = ImageDraw.Draw(base, "RGBA")
    for _ in range(rng.randint(1200, 1500)):
        x, y = rng.randrange(HALF), rng.randrange(HALF)
        tone = FIBRE_DARK if rng.random() < 0.55 else FIBRE_LIGHT
        draw.rectangle((x, y, x + rng.choice((0, 1)), y + rng.choice((0, 1))),
                       fill=(*tone, rng.randint(40, 78)))

    # 纤维走向：1~2px 宽的短须
    for _ in range(rng.randint(260, 320)):
        x, y = rng.randrange(HALF), rng.randrange(HALF)
        length = rng.randint(4, 13)
        angle = rng.uniform(0, 6.283)
        draw.line((x, y,
                   x + math.cos(angle) * length,
                   y + math.sin(angle) * length),
                  fill=(*FIBRE, rng.randint(32, 62)), width=rng.choice((1, 1, 2)))
    base = base.filter(ImageFilter.GaussianBlur(0.3))

    tile = Image.new("RGB", (TILE, TILE))
    tile.paste(base, (0, 0))
    tile.paste(base.transpose(Image.FLIP_LEFT_RIGHT), (HALF, 0))
    tile.paste(tile.crop((0, 0, TILE, HALF)).transpose(Image.FLIP_TOP_BOTTOM), (0, HALF))

    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / "paper-tile.webp"
    tile.save(target, "WEBP", lossless=True, method=6)
    size_kb = round(target.stat().st_size / 1024)

    # 自检：颗粒到底有没有留下来
    import PIL.ImageChops as chops
    from PIL import ImageStat
    blur = tile.filter(ImageFilter.GaussianBlur(1.2))
    detail = ImageStat.Stat(chops.difference(tile, blur).convert("L"))
    grey = ImageStat.Stat(tile.convert("L"))
    print(f"paper-tile: {TILE}×{TILE}  {size_kb}KB  "
          f"标准差 {grey.stddev[0]:.2f}  高频细节 {detail.mean[0]:.2f}")
    if size_kb > MAX_KB:
        print(f"  !! 超过 {MAX_KB}KB，需要减小特征尺度或换更小的砖")


main()
