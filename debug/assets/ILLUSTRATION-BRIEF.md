# 插画清单与风格契约

要给这套界面加"真正的插画"，缺的不是代码，是 12 张图。下面这份清单可以直接交给生成工具或画师。
每张图落地后都能立刻生效：放对文件名，页面会自动用它盖掉现在的矢量版，布局一行不用改。

---

## 一、该放插画的地方，以及不该放的

**该放（两头）：**

| 位置 | 张数 | 目标尺寸 | 目标体积 | 为什么值 |
| --- | --- | --- | --- | --- |
| 首页主视觉 | 1 | 2400 × 1350 | ≤ 250KB | 第一眼，全场唯一的整幅画 |
| 卡牌详版（资源 5 + 发展 5） | 10 | 640 × 560 | ≤ 45KB | 玩家会凑近看的地方 |
| 结算 / 图鉴头图 | 1 | 1600 × 800 | ≤ 120KB | 叙事收尾 |

**不该放：**

- **棋盘地块、海岸线、港口**：这里的任务是"看清"。插画会压掉数字令牌与棋子的可读性，体积还要大十倍。棋盘继续用矢量。
- **手牌小卡（60px 宽）**：任何插画到这个尺寸都会糊成色块，现在的缩略风景已经是这个尺寸的上限。
- **按钮与面板**：装饰性插画在密集控件里只会变成噪音。

一句话：**入口和细看放插画，密度高的地方保持矢量。**

---

## 二、风格契约（12 张共用，必须一致）

每张提示词前面都要带这一段，否则 12 张图放一起会像 12 个人画的：

```
Hand-drawn ink and pale watercolour illustration for a board game, in the manner of a
19th-century nautical chart or copper-plate book engraving.

Style: fine dark ink outlines (near #2E2A22) with hatching and stipple for shadow instead of
gradients. Muted Morandi earth palette only: grey-teal #8CA29C, oak #AE8C63, moss green #6E8570,
clay #B0846A, wheat #C7B776, sand #D7CEB2, over aged parchment #E8E2D0. Very low contrast, flat
even daylight, no dramatic backlight, no sunset.

Composition: subject fully inside the frame with about 8% margin, no drawn border, no vignette.

Constraints: no photorealism, no dark moody lighting, no high-contrast gradient, no 3D render, no
glossy digital painting, no cartoon or chibi style, no thick cartoon outlines with white
highlights, no text, no lettering, no numbers, no signature, no watermark.
```

其中三条是硬线，破了就和整块界面打架：**低饱和、平光、不用渐变**。参考图那种落日暗调写实属于明确排除项。

---

## 三、逐张主体

**首页主视觉（`home-hero.webp`）**
> A wide bird's-eye view of a colonised island: a stone lighthouse on a rocky headland at the
> left, a wooden pier with a two-masted sailing ship, a small village of thatched huts around a
> stone keep, fenced farm plots, a river winding down from forested hills to a wide bay,
> mountains on the horizon, crates and barrels on the shore in the foreground.

**资源卡（`wood|brick|sheep|wheat|ore-illus.webp`）**

| 文件 | 主体 |
| --- | --- |
| `wood-illus.webp` | 缓坡海岬，三到五株松树，前景横放两段已伐木料与一把斧头，远处海面用平行细排线 |
| `brick-illus.webp` | 两层丘陵叠在一起，前景一条取土断面，横向层理 |
| `sheep-illus.webp` | 草坡与木栅，前景一只扎着三道绳的羊毛捆，旁边倚着牧杖 |
| `wheat-illus.webp` | 田界边两株松，垄沟向远处收拢，前面立着三束麦子 |
| `ore-illus.webp` | 远山连峰，近处山体开了矿洞，木框支着洞口，地上散着矿石 |

**发展卡（`knight|victoryPoint|roadBuilding|yearOfPlenty|monopoly-illus.webp`）**

| 文件 | 主体 |
| --- | --- |
| `knight-illus.webp` | 斜插的长旗、倚在旗杆旁的剑与盾，草坡排线；不画人与马，避开脸部与卡通风险 |
| `victoryPoint-illus.webp` | 一枚压在纸面上的封蜡印章，压着星形纹，下面拖一条绶带（这张刻意不画风景） |
| `roadBuilding-illus.webp` | 正在铺设的道路，枕木一根根压上去，路边堆着待用木板与一把锹 |
| `yearOfPlenty-illus.webp` | 一辆装到冒尖的车：麦束、木料、矿石、羊毛捆，地上还有两束割下的麦子 |
| `monopoly-illus.webp` | 天平与三只扎口货袋，袋口撒出麦穗和矿石，旁边一枚封蜡印章，背景海图网格与等深线 |

**结算头图（`results-hero.webp`）**
> An empty harbour at dusk seen from the pier: a moored ship, stacked crates, a folded flag,
> calm water with fine hatching. No people, no text.

---

## 四、出图与压缩

1. 生成时用比目标大一档的尺寸（首页 `1536×1024` 起步，卡面 `1024×896`，结算 `2048×1152`）。
2. 缩到目标尺寸后另存 **WebP 质量 80**（或 AVIF 质量 60）。
3. 只保留成品：原始大图不要放进 `debug/assets/`，放 `work/` 之类的工作目录。
4. 卡面四边留白约 8%：卡框会裁掉边缘，主体不能被切。

---

## 五、放文件与验收

文件一律放在 `debug/assets/`，文件名照上表，**不要改名**，页面按名字自动接管：

| 文件 | 用在哪 | 没有文件时显示什么 |
| --- | --- | --- |
| `home-hero.webp` | 首页整幅主视觉 | 现在的矢量海图 |
| `<资源>-illus.webp` | 卡牌详版 | 对应缩略风景 |
| `<牌名>-illus.webp` | 发展卡详版 | 对应缩略风景 |
| `results-hero.webp` | 结算头图 | 现状（无图） |

验收三步：

```bash
node scripts/check-art.mjs          # 尺寸、体积、格式、还缺哪张
```

1. **灰度测试**：把图去色，主体仍然认得出，说明没靠颜色撑构图。
2. **缩小测试**：缩到 25% 看，仍然能说出画的是什么，才算过关。
3. **并排测试**：把 12 张放一起看，像不像同一个人画的；不像就统一重跑一遍提示词。

---

## 六、怎么生成

技能自带命令行（默认模型 `gpt-image-2`），需要能访问 OpenAI 接口的网络与 `OPENAI_API_KEY`：

```cmd
set IMG=%CODEX_HOME%\skills\.system\imagegen\scripts\image_gen.py
python "%IMG%" generate --prompt-file prompts\home-hero.txt --size 1536x1024 ^
  --quality medium --no-augment --out home-hero-raw.png
```

`--no-augment` 是刻意的：让模型严格按上面那套"低饱和、平光、铜版排线"的约束走，不要被通用的"高质量、杰作"类修饰词带回高对比暗调。

如果手边有别的出图工具（即梦、混元、MJ、SD 都能用），把第二节的风格契约和第三节的主体拼起来就是完整提示词，不必用这个 CLI。
