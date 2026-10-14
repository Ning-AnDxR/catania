#!/usr/bin/env python
"""从首页主视觉里裁两条横向画带，做首页牌匾按钮的匾芯插画。

用法：
    pip install pillow
    python scripts/art-btn-vignette.py

为什么是"画带"而不是一整张画：牌匾按钮只有 75px 高、内窗约 309×45，
比例接近 7:1，任何方图塞进去都会被压成一条缝，所以裁成同样偏长的横条。
裁完再压一层纸色（wash），让它退到文字后面去，不跟标签抢。

想换成专门生成的插画：把 raw/btn-art-solo.png、raw/btn-art-online.png
放进 raw/，然后在 art-to-webp.py 的 SPECS 里加同名条目即可，
本脚本生成的只是在没有专门素材时的兜底。
"""
import pathlib

from PIL import Image

REPO = pathlib.Path(__file__).resolve().parent.parent
DEST = REPO / "debug" / "assets"

# 裁切框用构图比例（0-1）写，换源图尺寸也不用改
# (左, 上, 右, 下)：(0, 0) 是画面左上角，(1, 1) 是右下角
CROPS = {
    # 城堡 + 村落天际线
    "btn-art-solo": (0.325, 0.318, 0.792, 0.504, False),
    # 靠港的大帆船。船本来就偏画面左侧，而画带要贴在牌匾右边、左缘会被
    # 纸色渐变盖掉，所以整条左右翻转，让船落到右半边
    "btn-art-online": (0.065, 0.566, 0.768, 0.801, True),
}
MAX_KB = 60
WASH = (232, 226, 208)  # --paper
WASH_ALPHA = 0.18
# 成品尺寸固定下来，check-art.mjs 才能按尺寸校验
TARGETS = {
    "btn-art-solo": (720, 192),
    "btn-art-online": (1080, 240),
}
# 左缘渐隐占比：画带贴在牌匾右边，左边这条要化进纸里，别出现一条硬边
FEATHER_LEFT = 0.30
FEATHER_EDGE = 0.10


def source_image():
    for candidate in (
        REPO / "raw" / "home-hero.jpg",
        REPO / "raw" / "home-hero.png",
        DEST / "home-hero.webp",
    ):
        if candidate.exists():
            return candidate, Image.open(candidate).convert("RGB")
    raise SystemExit("找不到主视觉：raw/home-hero.jpg 或 debug/assets/home-hero.webp")


def wash(image):
    """压一层纸色，让插画退到文字后面。"""
    veil = Image.new("RGB", image.size, WASH)
    return Image.blend(image, veil, WASH_ALPHA)


def feather(image):
    """左缘、上下缘渐隐成透明，贴进匾芯时不会露出一个直角块。"""
    width, height = image.size
    mask = Image.new("L", (width, height))
    pixels = mask.load()
    for y in range(height):
        for x in range(width):
            left = min(1.0, x / (width * FEATHER_LEFT))
            edge = min(1.0, y / (height * FEATHER_EDGE),
                       (height - 1 - y) / (height * FEATHER_EDGE))
            pixels[x, y] = round(255 * left * edge)
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


source, hero = source_image()
print(f"源图 {source.name}  {hero.width}×{hero.height}")

for name, (x0, y0, x1, y1, flip) in CROPS.items():
    box = (round(x0 * hero.width), round(y0 * hero.height),
           round(x1 * hero.width), round(y1 * hero.height))
    strip = wash(hero.crop(box))
    if flip:
        strip = strip.transpose(Image.FLIP_LEFT_RIGHT)
    strip = feather(strip.resize(TARGETS[name], Image.LANCZOS))
    target = DEST / f"{name}.webp"
    for quality in (86, 80, 74, 66):
        strip.save(target, "WEBP", quality=quality, method=6)
        if target.stat().st_size <= MAX_KB * 1024:
            break
    size_kb = round(target.stat().st_size / 1024)
    print(f"{name}: 裁 {box}{' 并翻转' if flip else ''} -> "
          f"{strip.width}×{strip.height}  {size_kb}KB  "
          f"比例 {strip.width / strip.height:.2f}:1")
