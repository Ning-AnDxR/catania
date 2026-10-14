# 第二阶段设计：先把一个完整回合跑通

## 1. 阶段目标

第一阶段结束时，游戏状态停在 `AWAITING_ROLL`。这只说明初始放置已经完成，还没有证明游戏能够持续运转。

第二阶段暂不增加建造、强盗、发展卡或贸易，而是先完成下面这条回合闭环：

```text
AWAITING_ROLL
-> ROLL_DICE
-> DICE_ROLLED
-> RESOURCES_PRODUCED
-> TURN_ACTIONS
-> END_TURN
-> TURN_STARTED
-> AWAITING_ROLL
```

完成目标：

- 当前玩家能够合法掷骰。
- 骰子点数能够触发正确的地块资源生产。
- 银行库存不足时，资源生产结果仍然确定且一致。
- 当前玩家结束后，能够切换并启动下一位玩家。
- 相同随机种子和事件日志能够重放出相同状态。

### 阶段边界

第二阶段暂时不完整处理点数 `7`。

点数 `7` 会引出弃牌、移动强盗、选择偷取对象等多个等待状态。第二阶段先把它限制为一个明确分支：

```text
ROLL_DICE
-> 总点数为 7
-> 不生产资源
-> TURN_ACTIONS
-> END_TURN
```

第三阶段再把该分支替换成正式的强盗流程。

第二阶段明确不做：

- 建造道路、定居点和城市。
- 购买或使用发展卡。
- 银行贸易和玩家间贸易。
- WebSocket 联机。

## 2. 命令与阶段

第二阶段只新增两个命令：

```text
ROLL_DICE
END_TURN
```

新增阶段：

| 阶段 | 含义 | 允许命令 |
| --- | --- | --- |
| `AWAITING_ROLL` | 当前玩家等待掷骰 | `ROLL_DICE` |
| `TURN_ACTIONS` | 本回合已经掷骰，等待结束回合 | `END_TURN` |

`ROLL_DICE` 只负责校验掷骰条件、产生骰子结果并触发资源生产。

`END_TURN` 只负责结束当前玩家回合、切换玩家并重置回合状态。

## 3. ROLL_DICE

### 3.1 校验

只有同时满足以下条件，掷骰命令才会被接受：

- `actorId` 等于当前玩家。
- 当前阶段为 `AWAITING_ROLL`。
- 当前回合尚未掷骰。
- `expectedVersion` 与当前状态版本一致。

失败时返回明确错误：

```text
NOT_YOUR_TURN
INVALID_PHASE
ALREADY_ROLLED
VERSION_CONFLICT
```

### 3.2 状态变化

校验通过后，在一次事务中完成：

1. 使用可注入的随机数生成器产生两个骰子。
2. 记录 `die1`、`die2` 和 `total`。
3. 将 `turn.hasRolled` 设置为 `true`。
4. 产生 `DICE_ROLLED`。
5. 立即执行资源生产结算。
6. 将阶段切换到 `TURN_ACTIONS`。

资源生产不是一个单独按钮，而是本次成功的 `ROLL_DICE` 命令的一部分。

## 4. 资源生产

事件名：

```text
RESOURCES_PRODUCED
BANK_RESOURCE_SHORTAGE
RESOURCES_GAINED
HAND_CHANGED
```

### 4.1 结算顺序

1. 使用两个骰子的总点数找到所有数字令牌相同的资源地块。
2. 扫描这些地块的相邻顶点。
3. 定居点产生 1 份需求，城市产生 2 份需求。
4. 按资源类型汇总本次掷骰的总需求。
5. 检查银行库存是否足够。
6. 库存足够时统一扣除银行并增加玩家手牌。
7. 库存不足时，本次掷骰中该资源不发放给任何玩家，并产生 `BANK_RESOURCE_SHORTAGE`。

### 4.2 银行短缺规则

不能看到一块地就直接发资源。否则可能出现前面玩家已经获得资源、后面玩家才发现银行库存不足的情况，最终结果会依赖玩家顺序。

正确做法是先汇总整次掷骰的资源需求，再一次性判断能否发放。

```text
if bank[resource] >= totalDemand:
  distribute(resource)
else:
  emit BANK_RESOURCE_SHORTAGE
  distribute nothing for this resource
```

### 4.3 确定性

为了保证事件重放的一致性：

- 使用可注入的随机数生成器。
- 固定事件处理顺序。
- 发放资源时按照 `hexId` 和 `playerId` 排序。
- 不用对象属性遍历顺序决定发牌顺序。

公开事件只能说明哪个地块生产了什么资源，不能泄露其他玩家的完整手牌。

## 5. 回合状态

状态中增加独立回合信息：

```ts
type TurnState = {
  hasRolled: boolean;
  dice: {
    die1: number;
    die2: number;
    total: number;
  } | null;
  production: Array<{
    hexId: number;
    resource: ResourceType;
    gains: Array<{
      playerId: number;
      amount: number;
    }>;
  }>;
};
```

`turn` 记录当前玩家这一回合进行到哪里，不与游戏整体进度混在一起。

在 `END_TURN` 时：

```text
hasRolled = false
dice = null
production = []
```

## 6. PlayerView

`PlayerView` 不直接暴露完整权威状态，只生成当前玩家可见的信息和合法命令。

```text
AWAITING_ROLL + 当前玩家
-> validCommands: [ROLL_DICE]

TURN_ACTIONS + 当前玩家
-> validCommands: [END_TURN]
```

界面只展示 `validCommands`，不再自行判断按钮是否可以点击。真正的合法性仍由规则引擎确认。

## 7. END_TURN

`END_TURN` 必须完成一次原子更新：

```text
TURN_ENDED
-> 切换 currentPlayerId
-> 重置 hasRolled、dice、production
-> TURN_STARTED
-> PHASE_CHANGED: TURN_ACTIONS -> AWAITING_ROLL
```

回合编号规则：

- `turnNumber` 表示第几轮，而不是第几个玩家动作。
- 当前玩家从最后一位切回第一位时，`turnNumber` 增加 1。
- 同一轮内换人只修改 `currentPlayerId`。
- 一个 `END_TURN` 命令只增加一次状态版本。
- 同一命令产生的多个事件共享版本号，但通过 `sequence` 保持顺序。

## 8. 事件

| Event | 可见性 | 说明 |
| --- | --- | --- |
| `DICE_ROLLED` | `PUBLIC` | 记录玩家、两个骰子和总点数 |
| `RESOURCES_PRODUCED` | `PUBLIC` | 记录地块、资源和公开收益摘要 |
| `BANK_RESOURCE_SHORTAGE` | `PUBLIC` | 记录短缺资源、请求量和可用量 |
| `RESOURCES_GAINED` | `PUBLIC` | 记录玩家从资源生产中获得资源 |
| `HAND_CHANGED` | `PLAYER` | 私下通知玩家完整手牌变化 |
| `TURN_ENDED` | `PUBLIC` | 记录当前玩家结束回合 |
| `TURN_STARTED` | `PUBLIC` | 启动下一位玩家 |
| `PHASE_CHANGED` | `PUBLIC` | 在 `AWAITING_ROLL` 与 `TURN_ACTIONS` 之间切换 |

## 9. 测试清单

- 非当前玩家执行 `ROLL_DICE` 时被拒绝，且状态不变。
- 同一玩家在同一回合连续掷骰两次时，第二次返回 `ALREADY_ROLLED`。
- 固定骰子结果时，只让数字令牌匹配的地块生产资源。
- 定居点获得 1 份资源，城市获得 2 份资源。
- 沙漠地块和点数不匹配的地块不生产资源。
- 银行库存不足时，该资源本次掷骰不发放给任何玩家。
- 每次生产前后的银行库存与玩家手牌总量守恒。
- `END_TURN` 后正确切换玩家、重置回合状态并回到 `AWAITING_ROLL`。
- 四名玩家连续完成多轮回合，不会卡死在 `TURN_ACTIONS`。
- 事件全部重放后，得到的状态与直接执行命令后的状态一致。

## 10. 完成标准

满足以下条件后，第二阶段才算完成：

- 玩家和 AI 可以连续完成多轮回合。
- 任意随机骰子结果都能完成资源结算并顺利换人。
- 银行资源不会凭空增加或丢失。
- 任何一次资源变化都能在事件日志中找到原因。
- 前端刷新后能够按版本恢复一致状态。

完成这一阶段后，建造道路、定居点和城市只需作为 `TURN_ACTIONS` 阶段中的新命令接入，不需要推翻回合循环。

后续顺序：

```text
第二阶段：掷骰、资源生产、结束回合
-> 建造系统
-> 点数 7、弃牌、强盗、偷取资源
-> 发展卡
-> 玩家间贸易
-> WebSocket 联机
```
