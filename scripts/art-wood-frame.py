#!/usr/bin/env python
"""生成一张专用木质边框图，给工具格 / 弹窗当 border-image 用。

用法：
    pip install pillow
    python scripts/art-wood-frame.py

为什么不能直接切按钮底板那张：底板木框沿边框方向有结疤和大块明暗。九宫格把
边缘横向拉伸时，这些"大特征"会被拉长（宽面板）或压密（窄面板），实测 241px 的
骰子格与 466px 的建造格木纹密度差了近一倍，看着像两种木头。

这里改成：木纹细、且**沿边框方向均匀**。横向拉伸只会把线拉长，密度不变，
所以任意宽度的面板看起来都是同一块木头。

尺寸规矩：512×512，边框带 64px，四角各一颗铆钉。CSS 里配
    border-image-slice: 64;  border-image-width: 8px;
角上 64×64 的区域按 1:8 缩到 8px，四个角在任何面板上都是同一个尺寸。
"""
import math
import pathlib
import random

from PIL import Image, ImageDraw

DEST = pathlib.Path(__file__).resolve().parent.parent / "debug" / "assets"
SIZE = 512
INSET = 8            # 外边留白，免得外墨线被裁
FRAME = 64           # 木框带厚度（CSS 的 slice 值）
RADIUS = 16          # 圆角
RIVET_R = 11
MAX_KB = 60

OAK = (174, 140, 99)
GRAIN_DARK = (124, 98, 66)
GRAIN_LIGHT = (198, 168, 126)
INK = (46, 42, 34)
STUD = (215, 206, 178)

rng = random.Random(20261013)


def rounded(inset, radius):
    return (inset, inset, SIZE - 1 - inset, SIZE - 1 - inset), radius


def band_mask():
    """木框带（外圆角矩形减内圆角矩形）的掩膜。"""
    mask = Image.new("L", (SIZE, SIZE), 0)
    d = ImageDraw.Draw(mask)
    box, r = rounded(INSET, RADIUS)
    d.rounded_rectangle(box, radius=r, fill=255)
    inner, ir = rounded(INSET + FRAME, max(2, RADIUS - 6))
    d.rounded_rectangle(inner, radius=ir, fill=0)
    return mask


def grain_layer():
    """细木纹：上下带只画横线、左右带只画竖线 —— 都沿边框走向。

    只画一个方向是有讲究的：沿走向的线在九宫格横向拉伸时只是被拉长，密度不变，
    所以 241 宽和 466 宽的面板看起来是同一块木头；纵横都画会变成"梳过"的交叉纹。
    """
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    lo, hi = INSET, SIZE - 1 - INSET
    # 上下两条带：横线
    for y in list(range(lo, lo + FRAME, 2)) + list(range(hi - FRAME + 1, hi + 1, 2)):
        if rng.random() < 0.18:
            continue
        tone = GRAIN_DARK if rng.random() < 0.45 else GRAIN_LIGHT
        d.line((lo, y, hi, y), fill=(*tone, rng.randint(32, 68)), width=2)
    # 左右两条带：竖线
    for x in list(range(lo, lo + FRAME, 2)) + list(range(hi - FRAME + 1, hi + 1, 2)):
        if rng.random() < 0.18:
            continue
        tone = GRAIN_DARK if rng.random() < 0.45 else GRAIN_LIGHT
        d.line((x, lo, x, hi), fill=(*tone, rng.randint(32, 68)), width=2)
    return layer


def main():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    box, r = rounded(INSET, RADIUS)
    d.rounded_rectangle(box, radius=r, fill=(*OAK, 255))

    mask = band_mask()
    img = Image.composite(img, Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask)
    grain = Image.composite(grain_layer(), Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0)), mask)
    img = Image.alpha_composite(img, grain)

    # 内外墨线
    d = ImageDraw.Draw(img)
    d.rounded_rectangle(box, radius=r, outline=(*INK, 235), width=2)
    inner, ir = rounded(INSET + FRAME, max(2, RADIUS - 6))
    d.rounded_rectangle(inner, radius=ir, outline=(*INK, 225), width=2)

    # 四角铆钉
    c = INSET + 26
    for cx, cy in ((c, c), (SIZE - 1 - c, c), (c, SIZE - 1 - c), (SIZE - 1 - c, SIZE - 1 - c)):
        d.ellipse((cx - RIVET_R, cy - RIVET_R, cx + RIVET_R, cy + RIVET_R),
                  fill=(*STUD, 255), outline=(*INK, 240), width=2)
        d.arc((cx - RIVET_R + 3, cy - RIVET_R + 3, cx + RIVET_R - 3, cy + RIVET_R - 3),
              200, 340, fill=(*INK, 90), width=2)

    DEST.mkdir(parents=True, exist_ok=True)
    target = DEST / "wood-frame.webp"
    target.write_bytes(b"")
    for lossless in (False, True):
        for quality in (88, 80, 72, 64):
            if lossless:
                img.save(target, "WEBP", lossless=True, method=6)
            else:
                img.save(target, "WEBP", quality=quality, method=6)
            if target.stat().st_size <= MAX_KB * 1024:
                break
        if target.stat().st_size <= MAX_KB * 1024:
            print(f"paper-frame: {'lossless' if lossless else 'q' + str(quality)}")
            break

    import PIL.ImageChops as chops
    from PIL import ImageFilter, ImageStat
    loaded = Image.open(target).convert("RGBA")
    detail = ImageStat.Stat(chops.difference(
        loaded.convert("RGB"),
        loaded.convert("RGB").filter(ImageFilter.GaussianBlur(1.4))).convert("L"))
    print(f"wood-frame: {SIZE}×{SIZE} {round(target.stat().st_size / 1024)}KB  "
          f"高频细节 {detail.mean[0]:.2f}")
    if detail.mean[0] < 0.4:
        print("  !! 木纹被压缩抹平了，需要把线加粗或改无损")


main()
