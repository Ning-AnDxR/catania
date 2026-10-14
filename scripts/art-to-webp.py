#!/usr/bin/env python
"""把 raw/ 里生成的大图缩到规格尺寸并转成 WebP，直接写进 debug/assets/。

用法：
    pip install pillow
    python scripts/art-to-webp.py [raw 目录，默认 raw]

生成时用大一档尺寸（卡面 1024×896、首页 1536×1024、结算 2048×1152），
本脚本负责缩到目标尺寸并压到目标体积，文件名会自动对上页面读取的名字。

按钮底板（btn-plate*）多两道工序：生成时是 2048×2048 方图、板子只占中间一块
且有白底和投影，直接压成横图会把木框横向拉宽。所以先按饱和色找出板子外沿裁掉
四周空白，再把与画布边缘连通的浅色（白底 + 投影）抠成透明，最后才缩放。
抠完底板是正方形的，九宫格切片的四角才不会被拉成椭圆。
"""
import pathlib
import sys
from collections import deque

try:
    from PIL import Image
except ImportError:
    sys.exit("需要 Pillow：pip install pillow")

# 路径锚在仓库根目录上：不管从哪个目录执行，都写进 debug/assets、都读仓库根的 raw
REPO = pathlib.Path(__file__).resolve().parent.parent
DEST = REPO / "debug" / "assets"
RAW = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "raw"

# 输出名 -> (宽, 高, 体积上限 KB)
SPECS = {
    "home-hero": (2400, 1350, 250),
    "wood-illus": (640, 560, 45),
    "brick-illus": (640, 560, 45),
    "sheep-illus": (640, 560, 45),
    "wheat-illus": (640, 560, 45),
    "ore-illus": (640, 560, 45),
    "knight-illus": (640, 560, 45),
    "victoryPoint-illus": (640, 560, 45),
    "roadBuilding-illus": (640, 560, 45),
    "yearOfPlenty-illus": (640, 560, 45),
    "monopoly-illus": (640, 560, 45),
    "results-hero": (1600, 800, 120),
    # 棋盘底下的手绘海图：铺满整块海域，中段留空给棋盘压上去
    "board-sea": (2048, 1152, 250),
    # 按钮底板：整块拉伸用的空牌，中间留空由 HTML 写字
    "btn-plate": (512, 512, 45),
    "btn-plate-primary": (512, 512, 45),
    "btn-plate-yes": (512, 512, 45),
}

PLATES = {"btn-plate", "btn-plate-primary", "btn-plate-yes"}


def fit_cover(image, want_w, want_h):
    """按目标比例从中心裁一刀再缩放，而不是把图拉变形。

    生成的插画都是 1536×1024（3:2），目标尺寸比例各不相同：直接 resize 会让
    骑士的圆盾变成扁椭圆、木材截面的圆变成椭圆、灯塔被拉粗。这里改成先裁到
    目标比例再缩放，主体都在画面中间，裁掉的是两侧或上下的空白。
    """
    target = want_w / want_h
    current = image.width / image.height
    if abs(current - target) < 0.01:
        return image.resize((want_w, want_h), Image.LANCZOS)
    if current > target:
        width = round(image.height * target)
        left = (image.width - width) // 2
        image = image.crop((left, 0, left + width, image.height))
    else:
        height = round(image.width / target)
        top = (image.height - height) // 2
        image = image.crop((0, top, image.width, top + height))
    return image.resize((want_w, want_h), Image.LANCZOS)


def _sat(pixel):
    return max(pixel[:3]) - min(pixel[:3])


def _lum(pixel):
    return sum(pixel[:3]) / 3


def _is_backdrop(pixel):
    """白底与投影都是低饱和的浅灰；木框饱和、墨线很暗，都不会被判成背景。"""
    return _sat(pixel) <= 14 and _lum(pixel) >= 150


def cut_plate(source):
    """裁到木框外沿并抠掉白底，返回 RGBA 图。"""
    image = Image.open(source).convert("RGB")
    width, height = image.size
    pixels = image.load()

    step = max(1, min(width, height) // 600)
    xs, ys = [], []
    for y in range(0, height, step):
        for x in range(0, width, step):
            if _sat(pixels[x, y]) > 18:
                xs.append(x)
                ys.append(y)
    if not xs:
        return None

    pad = max(2, round(0.003 * width))
    box = (
        max(0, min(xs) - pad),
        max(0, min(ys) - pad),
        min(width, max(xs) + pad + 1),
        min(height, max(ys) + pad + 1),
    )
    image = image.crop(box)
    width, height = image.size
    pixels = image.load()

    # 从画布四条边往里泛洪，凡是连通的浅色都算画布底 -> 透明
    outside = bytearray(width * height)
    queue = deque()

    def push(x, y):
        index = y * width + x
        if not outside[index] and _is_backdrop(pixels[x, y]):
            outside[index] = 1
            queue.append((x, y))

    for x in range(width):
        push(x, 0)
        push(x, height - 1)
    for y in range(height):
        push(0, y)
        push(width - 1, y)
    while queue:
        x, y = queue.popleft()
        if x:
            push(x - 1, y)
        if x < width - 1:
            push(x + 1, y)
        if y:
            push(x, y - 1)
        if y < height - 1:
            push(x, y + 1)

    alpha = Image.frombytes("L", (width, height), bytes(outside)).point(
        lambda value: 0 if value else 255
    )
    # 透明区的 RGB 统一留白，缩放时不会把灰边拉进木框
    flat = Image.composite(image, Image.new("RGB", (width, height), (255, 255, 255)), alpha)
    result = flat.convert("RGBA")
    result.putalpha(alpha)
    return result


DEST.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)
done = skipped = 0

claimed = set()
# 名字长的先认领文件：否则 btn-plate 会把 btn-plate-primary 抢走
for name in sorted(SPECS, key=len, reverse=True):
    want_w, want_h, max_kb = SPECS[name]
    candidates = [
        candidate
        for candidate in RAW.glob(f"{name}*")
        if candidate.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")
        and candidate not in claimed
    ]
    # 文件名正好等于 name 的排最前。只用字母序的话 board-sea-preview.webp 会排在
    # board-sea.jpg 前面（'-' 比 '.' 小），把真正的原稿挤掉。
    candidates.sort(key=lambda p: (p.stem != name, p.name))
    source = candidates[0] if candidates else None
    if source is not None:
        claimed.add(source)
    if source is None:
        print(f"跳过 {name}：{RAW} 里没有对应文件")
        skipped += 1
        continue

    if name in PLATES:
        image = cut_plate(source)
        if image is None:
            print(f"跳过 {name}：{source.name} 里找不到木框（没有饱和色像素）")
            skipped += 1
            continue
        image = image.resize((want_w, want_h), Image.LANCZOS)
    else:
        image = fit_cover(Image.open(source).convert("RGB"), want_w, want_h)

    target = DEST / f"{name}.webp"
    for quality in (80, 72, 64, 56, 50, 44):
        image.save(target, "WEBP", quality=quality, method=6)
        if target.stat().st_size <= max_kb * 1024:
            break
    size_kb = round(target.stat().st_size / 1024)
    flag = "ok" if size_kb <= max_kb else f"仍超 {max_kb}KB"
    print(f"{source.name} -> {target.name}  {want_w}×{want_h}  {size_kb}KB  {flag}")
    done += 1

print(f"\n完成 {done} 张，跳过 {skipped} 张。跑一次 node scripts/check-art.mjs 复核。")
