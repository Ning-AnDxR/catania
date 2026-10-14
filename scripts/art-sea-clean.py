#!/usr/bin/env python
"""把手绘海图中间那个六边形框抹掉，其它一笔不动。

用法：
    pip install pillow
    python scripts/art-sea-clean.py [输出路径]

不写输出路径就覆盖 debug/assets/board-sea.webp（也就是页面正在用的那张）。

为什么抹它：海图上那个六边形是"棋盘放这里"的位置标记，但棋盘是跟着窗口缩放的
（.board-canvas 用 rem 上下留边，棋盘再按比例塞进去），固定尺寸的六边形只在某一个
窗口大小下刚好对上，换个尺寸就会错开。去掉它，罗经花、帆船、四角礁石和外框全留着。

做法：只在画面中段找墨线像素，做连通域，只保留跨幅最大的那条（六边形本身；
旁边零星的小浪纹跨幅小，留着不动），然后拿一张重度模糊的底把它糊掉。
"""
import collections
import pathlib
import sys

from PIL import Image, ImageFilter

REPO = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / "debug" / "assets" / "board-sea.webp"
WANT = (2048, 1152)
LUMA_CUT = 190          # 明显比羊皮纸暗的算墨线
REGION = (0.10, 0.02, 0.90, 0.98)   # 只看中段：罗经花、帆船、礁石、外框都在外面
MIN_SPAN = 0.25         # 包围盒对角线超过画面宽度这个比例才算六边形
MAX_KB = 250


def find_source():
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        path = REPO / "raw" / f"board-sea{ext}"
        if path.exists():
            return path
    raise SystemExit("raw/ 里找不到 board-sea.png / board-sea.jpg")


def hexagon_mask(image):
    """返回六边形那一条线的掩膜（bytearray，长度 w*h）。"""
    width, height = image.size
    luma = image.convert("L").point(lambda v: 255 if v < LUMA_CUT else 0)
    data = luma.tobytes()

    x0, y0 = round(REGION[0] * width), round(REGION[1] * height)
    x1, y1 = round(REGION[2] * width), round(REGION[3] * height)

    seen = bytearray(width * height)
    mask = bytearray(width * height)
    kept = []
    min_span = width * MIN_SPAN

    for y in range(y0, y1):
        base = y * width
        row = data[base:base + width]
        x = row.find(255, x0, x1)
        while x != -1:
            index = base + x
            if not seen[index]:
                seen[index] = 1
                queue = collections.deque([(x, y)])
                pixels = []
                bx0 = bx1 = x
                by0 = by1 = y
                while queue:
                    cx, cy = queue.popleft()
                    pixels.append((cx, cy))
                    if cx < bx0: bx0 = cx
                    if cx > bx1: bx1 = cx
                    if cy < by0: by0 = cy
                    if cy > by1: by1 = cy
                    for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                        if x0 <= nx < x1 and y0 <= ny < y1:
                            n = ny * width + nx
                            if data[n] and not seen[n]:
                                seen[n] = 1
                                queue.append((nx, ny))
                span = ((bx1 - bx0) ** 2 + (by1 - by0) ** 2) ** 0.5
                if span > min_span:
                    print(f"  找到跨幅 {span:.0f}px 的线，{len(pixels)} 个墨点 -> 抹掉")
                    for cx, cy in pixels:
                        mask[cy * width + cx] = 1
                else:
                    kept.append(span)
            x = row.find(255, x + 1, x1)
    if kept:
        print(f"  留下 {len(kept)} 处小笔画（浪纹、墨点），最大跨幅 {max(kept):.0f}px")
    return mask


def inpaint(image, alpha, rounds=16, radius=4):
    """只在洞里迭代取模糊值，洞外永远保留原图 —— 周围的羊皮纸会一点点渗进洞里。

    不能直接拿"整张糊一遍"的结果去补：那样六边形本身也被糊回来，会留一道灰影。
    """
    work = image.copy()
    for _ in range(rounds):
        work = Image.composite(work.filter(ImageFilter.GaussianBlur(radius)), image, alpha)
    return work


def main():
    out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    source = find_source()
    image = Image.open(source).convert("RGB").resize(WANT, Image.LANCZOS)
    width, height = image.size
    print(f"源图 {source.name} -> {width}×{height}")

    mask = hexagon_mask(image)
    print(f"  墨线像素合计 {sum(mask)}")
    if not any(mask):
        raise SystemExit("没找到那条线，检查阈值或 REGION")

    alpha = Image.frombytes("L", (width, height), bytes(255 if v else 0 for v in mask))
    alpha = alpha.filter(ImageFilter.MaxFilter(7))   # 两边各长 3px，盖住抗锯齿
    clean = inpaint(image, alpha)

    out.parent.mkdir(parents=True, exist_ok=True)
    for quality in (86, 80, 74, 66):
        clean.save(out, "WEBP", quality=quality, method=6)
        if out.stat().st_size <= MAX_KB * 1024:
            break
    print(f"写出 {out}  {round(out.stat().st_size / 1024)}KB")


main()
