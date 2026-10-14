# 第一阶段实现说明

## 目标

验证核心业务结构，而不是一次性实现完整 Catan。

第一阶段完成：

```text
LOBBY
-> START_GAME
-> SETUP_ROUND_1
-> SETUP_ROUND_2
-> AWAITING_ROLL
```

## Command

当前实现三个命令：

```text
START_GAME
PLACE_INITIAL_SETTLEMENT
PLACE_INITIAL_ROAD
```

每个命令都通过 `dispatchCommand` 进入规则引擎：

```text
CommandEnvelope
-> 校验 gameId
-> 校验 expectedVersion
-> 校验玩家和阶段
-> 克隆状态
-> 执行状态变化
-> 产生 Event
-> 返回新 state 和 CommandResult
```

被拒绝的命令不会修改状态，也不会增加版本号。

## Event

当前事件：

```text
GAME_STARTED
BOARD_CREATED
PHASE_CHANGED
TURN_STARTED
SETTLEMENT_PLACED
ROAD_PLACED
RESOURCES_GAINED
SETUP_COMPLETED
```

事件被写入 `state.eventLog`，调试 UI 只根据事件日志展示过程。

## 蛇形顺序

四名玩家的顺序为：

```text
0, 1, 2, 3, 3, 2, 1, 0
```

每一轮请求包含一个定居点命令和一条道路命令。

## 合法性校验

初始定居点：

- 当前玩家正确
- 阶段正确
- 当前处于定居点步骤
- 顶点存在
- 顶点为空
- 相邻顶点没有建筑

初始道路：

- 当前玩家正确
- 当前处于道路步骤
- 边存在
- 边为空
- 边必须连接刚放置的定居点

## 初始资源

游戏开始时，每名玩家每种资源默认获得 1 张。

两个初始村庄不再额外获得相邻地块资源，只用于确定初始位置。

## 单机与联机

UI 调用：

```js
session.dispatch(actorId, command);
```

当前由 `LocalGameSession` 直接执行规则引擎。

未来联机时保留同样接口，只替换传输实现：

```text
LocalGameSession
-> dispatchCommand

RemoteGameSession
-> WebSocket
-> 服务器 dispatchCommand
-> 广播 Event / StatePatch
```

## AI

当前 AI 只实现合法随机选择：

```js
chooseRandomCommand(view)
```

AI 从 `PlayerView.validCommands` 中挑选命令，不直接修改状态。

第二阶段可以替换为启发式评分，但接口不变。

## 验收结果

自动化测试：

```text
12 tests passed
```

浏览器实测：

```text
玩家和三个 AI 各完成两个定居点、两条道路
第二轮资源正确发放
状态进入 AWAITING_ROLL
浏览器控制台没有错误
```

## 下一阶段

接着实现：

```text
ROLL_DICE
DICE_ROLLED
RESOURCES_PRODUCED
BANK_RESOURCE_SHORTAGE
END_TURN
TURN_STARTED
```

不要直接跳到建造系统。先把完整回合循环、银行库存和资源生产测试稳定。
