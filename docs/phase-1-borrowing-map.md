# 第一阶段开源项目借鉴映射

本项目没有复制无许可证仓库的代码。MIT 项目也只借鉴结构和算法，并在实现时使用自己的命名、状态结构和测试。

## 总览

| 参考项目 | 许可证 | 第一阶段用途 |
| --- | --- | --- |
| `hex-catan-multiplayer` | MIT | 棋盘图、权威状态、阶段、事件日志、Bot 接口 |
| `settlers-of-the-island` | 无 LICENSE | 仅研究蛇形设置和轻量单机流程 |
| `catan-3d` | 无 LICENSE | 仅研究六边形棋盘图、渲染和数据组织 |
| `catanatron` | GPL-3.0 | 仅研究初始建造阶段的规则边界和测试思路 |

## `hex-catan-multiplayer`

参考文件：

```text
server/game/HexGrid.js
server/game/BoardManager.js
server/game/GameEngine.js
server/game/BotAI.js
server/game/BotRunner.js
```

具体借鉴：

- 使用 `Map` 保存顶点和边，并按共享角点自动去重。
- 每个顶点保存相邻顶点、相邻边和所属地块。
- 每条边保存两个顶点、相邻地块和道路占用。
- 海岸边用于港口生成。
- 阶段使用 `SETUP_ROUND_1` 和 `SETUP_ROUND_2`。
- 初始放置使用 `setupStep = settlement | road`。
- 第二轮初始定居点发放相邻资源。
- 服务端函数先校验，再修改状态，再记录事件。
- Bot 使用与人类相同的动作入口，不直接操作内部状态。
- 面向客户端的玩家状态与完整状态分开投影。

本项目对应实现：

```text
src/core/board.js
src/core/engine.js
src/core/projection.js
src/core/session.js
src/bots/random-bot.js
```

没有引入第一阶段不需要的 Cities and Knights、Redis、房间、排行榜和多人计时器。

## `settlers-of-the-island`

参考文件：

```text
js/board.js
js/game.js
js/ai.js
tests/game.test.mjs
```

具体借鉴：

- 19 个六边形的地形和数字排列。
- `setupQueue` 使用正向玩家顺序加反向玩家顺序。
- 每条设置记录由定居点和道路组成。
- `setupPlacedVertex` 表示道路必须连接的刚放置定居点。
- 第二轮初始定居点从相邻地块获得资源。
- 设置完成后进入掷骰阶段。
- AI 从合法放置列表中选择，不越过规则直接落子。

本项目对应实现：

```text
src/core/state.js
src/core/engine.js
src/bots/random-bot.js
tests/setup.test.js
```

许可证说明：

该仓库没有 LICENSE 文件。本项目只参考流程和算法思想，没有复制其源码。

## `catan-3d`

参考文件：

```text
js/board.js
js/game.js
js/scene.js
```

具体借鉴：

- `HEX_SIZE` 和六边形世界坐标。
- 每个地块的六个角转换为共享顶点。
- 地块、顶点和边分别保存为数组。
- 顶点记录所属地块和相邻关系。
- 边记录连接的两个顶点。
- `setupOrder` 使用玩家正向加反向顺序。
- 初始道路只允许连接最后放置的定居点。
- 渲染层读取领域数据，不自己计算规则。

本项目对应实现：

```text
src/core/board.js
debug/app.js
```

许可证说明：

该仓库没有 LICENSE 文件。本项目没有复制 Three.js 场景、模型生成或源码，只借鉴通用六边形图结构。

## `catanatron`

参考文件：

```text
catanatron/catanatron/apply_action.py
catanatron/catanatron/state_functions.py
catanatron/tests/test_game.py
```

具体借鉴：

- 初始建造阶段和正式回合是两个不同状态。
- 初始放置一个定居点后进入初始道路步骤。
- 第二个定居点触发起始资源。
- 初始道路完成后推进到一个明确的 `BUILD_INITIAL_SETTLEMENT` 或结束信号。
- 建筑与道路状态修改通过独立函数完成。
- 使用流程测试验证完整初始放置，而不仅是测试单个函数。

本项目对应实现：

```text
src/core/engine.js
tests/setup.test.js
tests/random-bot.test.js
```

许可证说明：

`catanatron` 使用 GPL-3.0。本项目没有复制其 Python 实现。后续如果直接复用其代码，需要评估整个项目的 GPL 合规要求。

## 本项目新增的设计

以下内容不是直接照搬任一仓库：

- 使用串行化的 `rngState`，避免把函数放进游戏状态。
- `expectedVersion` 和 `commandId` 从第一阶段就进入命令信封。
- 被拒绝的命令返回不变状态，并明确错误码。
- 每次成功命令统一增加一次 `version`，同时可以产生多个事件。
- `PlayerView.validCommands` 由规则引擎生成，UI 和 AI 共用。
- 调试 UI 只依赖 `PlayerView` 和事件日志。
- 测试直接覆盖版本冲突和非法状态不修改。

这些设计为后续 WebSocket 服务端和断线重连保留接口。

## 未借鉴的部分

第一阶段明确没有引入：

- Socket.IO 房间和重连
- Redis
- 账户和排行
- Cities and Knights
- Three.js 渲染
- Python AI 或强化学习
- 完整业务代码的复制

当前目标是先验证自己的 Command、Event 和 State 模型。

