# Catan Command / Event 清单

本文档定义基础版 Catan 的核心命令、事件、状态机、校验规则和 WebSocket 协议边界。
它适用于：

- 单机版人机对战
- 前端自行实现界面
- 规则引擎本地或服务端复用
- 后续升级为 WebSocket 联机版

## 1. 设计原则

1. 客户端界面不得直接修改游戏状态。
2. 所有玩家和 AI 动作都必须转换为 `GameCommand`。
3. 规则引擎负责校验命令并产生 `GameEvent`。
4. UI、动画、日志和音效根据事件响应，不根据按钮点击直接猜结果。
5. 单机版由本地引擎执行命令；联机版由权威服务器执行命令。
6. 随机数由可注入的 RNG 产生，联机版由服务器持有随机状态。
7. 每个状态都有单调递增的 `version`。
8. 每条命令都有唯一的 `commandId`，用于重试和幂等处理。
9. 事件必须标记可见性，对手手牌等隐藏信息不能发送给所有客户端。
10. AI 只能发送命令，不得直接改写状态。

## 2. 通用数据结构

```ts
type CommandEnvelope = {
  commandId: string;
  gameId: string;
  actorId: string;
  expectedVersion: number;
  command: GameCommand;
};

type CommandResult = {
  accepted: boolean;
  version: number;
  events: GameEventEnvelope[];
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

type GameEventEnvelope = {
  eventId: string;
  gameId: string;
  version: number;
  type: GameEvent["type"];
  visibility: "PUBLIC" | "PRIVATE" | "PLAYER";
  recipientPlayerId?: string;
  payload: GameEvent;
};
```

`actorId` 在本地版由 UI 传入，在联机版由服务器根据 WebSocket 会话注入，客户端不能伪造。

## 3. 顶层状态机

| 阶段 | 含义 | 允许的主要命令 |
| --- | --- | --- |
| `LOBBY` | 创建房间或配置本地玩家 | `ADD_BOT`, `REMOVE_BOT`, `SET_PLAYER_READY`, `START_GAME` |
| `SETUP_ROUND_1` | 第一轮初始定居点和道路 | `PLACE_INITIAL_SETTLEMENT`, `PLACE_INITIAL_ROAD` |
| `SETUP_ROUND_2` | 第二轮初始放置，并发放第二定居点资源 | `PLACE_INITIAL_SETTLEMENT`, `PLACE_INITIAL_ROAD` |
| `AWAITING_ROLL` | 当前玩家等待掷骰 | `ROLL_DICE`, `PLAY_KNIGHT` |
| `RESOLVING_PRODUCTION` | 根据骰子结算资源或触发弃牌 | 自动处理，不接受普通命令 |
| `AWAITING_DISCARD` | 点数 7 后等待所有超限玩家弃牌 | `DISCARD_RESOURCES` |
| `AWAITING_ROBBER_MOVE` | 等待移动强盗 | `MOVE_ROBBER` |
| `AWAITING_STEAL_TARGET` | 等待选择偷取对象 | `CHOOSE_STEAL_TARGET` |
| `TURN_ACTIONS` | 掷骰后自由行动 | 建造、购买、发展卡、贸易、`END_TURN` |
| `AWAITING_RESOURCE_CHOICE` | 等待“丰收之年”选择资源 | `CHOOSE_RESOURCE` |
| `AWAITING_FREE_ROAD` | 等待“道路建设”免费放路 | `PLACE_FREE_ROAD` |
| `TRADE_NEGOTIATION` | 玩家间交易待响应 | `RESPOND_TO_TRADE`, `CONFIRM_TRADE`, `CANCEL_TRADE` |
| `GAME_OVER` | 游戏结束 | 只读，不接受游戏命令 |

## 4. 状态结构

```ts
type GameState = {
  gameId: string;
  version: number;
  phase: GamePhase;
  board: BoardState;
  players: PlayerState[];
  activePlayerId: string | null;
  turnNumber: number;
  bank: ResourcePool;
  developmentDeck: DevelopmentCard[];
  pendingAction: PendingAction | null;
  trade: TradeState | null;
  awards: {
    longestRoad: PlayerId | null;
    largestArmy: PlayerId | null;
  };
  rngState: string;
  winnerId: PlayerId | null;
  eventLog: GameEventEnvelope[];
};
```

`GameState` 是完整权威状态，只能存在于本地引擎或服务器。

发送给玩家的是 `PlayerView`：

```ts
type PlayerView = {
  version: number;
  phase: GamePhase;
  board: PublicBoardState;
  players: PublicPlayerState[];
  me: PrivatePlayerState;
  bank: PublicResourcePool;
  actions: ValidCommand[];
  trade: PublicTradeState | null;
  winnerId: PlayerId | null;
  log: VisibleLogEntry[];
};
```

## 5. Command 总表

### 5.1 会话与游戏生命周期

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `ADD_BOT` | `difficulty` | 玩家数小于上限，游戏未开始 | `BOT_ADDED` |
| `REMOVE_BOT` | `playerId` | 目标确实是 Bot，游戏未开始 | `BOT_REMOVED` |
| `SET_PLAYER_READY` | `ready` | 玩家存在，游戏未开始 | `PLAYER_READINESS_CHANGED` |
| `START_GAME` | `options` | 人数满足要求，全部就绪 | `GAME_STARTED`, `BOARD_CREATED`, `PHASE_CHANGED` |

### 5.2 初始放置

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `PLACE_INITIAL_SETTLEMENT` | `vertexId` | 当前放置者正确，节点为空，不违反距离规则 | `SETTLEMENT_PLACED`, `VICTORY_POINTS_CHANGED` |
| `PLACE_INITIAL_ROAD` | `edgeId` | 道路连接刚放下的定居点，边为空 | `ROAD_PLACED` |

第二轮放置定居点时，引擎额外发放相邻地块的一点资源。

### 5.3 回合与掷骰

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `ROLL_DICE` | `none` | 当前玩家正确，阶段为 `AWAITING_ROLL`，本回合尚未掷骰 | `DICE_ROLLED`, `RESOURCES_PRODUCED` 或 `DISCARD_REQUIRED` |
| `DISCARD_RESOURCES` | `resources` | 当前玩家确实需要弃牌，数量精确，手中资源足够 | `RESOURCES_DISCARDED` |
| `MOVE_ROBBER` | `hexId` | 当前玩家可移动强盗，目标不是当前所在地 | `ROBBER_MOVED` |
| `CHOOSE_STEAL_TARGET` | `playerId` | 目标相邻且拥有资源 | `RESOURCE_STOLEN`, `HAND_CHANGED` |
| `END_TURN` | `none` | 无未完成动作，阶段为 `TURN_ACTIONS` | `TURN_ENDED`, `TURN_STARTED`, `PHASE_CHANGED` |

### 5.4 建造

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `BUILD_ROAD` | `edgeId` | 边为空，与己方道路或建筑连接，资源足够，棋子未耗尽 | `RESOURCES_SPENT`, `ROAD_PLACED`, `LONGEST_ROAD_CHANGED` |
| `BUILD_SETTLEMENT` | `vertexId` | 节点为空，距离规则通过，连接己方道路，资源足够，剩余定居点足够 | `RESOURCES_SPENT`, `SETTLEMENT_PLACED`, `VICTORY_POINTS_CHANGED` |
| `BUILD_CITY` | `vertexId` | 节点是己方定居点，资源足够，剩余城市足够 | `RESOURCES_SPENT`, `CITY_PLACED`, `VICTORY_POINTS_CHANGED` |
| `BUY_DEVELOPMENT_CARD` | `none` | 当前阶段允许购买，资源足够，牌堆非空 | `RESOURCES_SPENT`, `DEVELOPMENT_CARD_PURCHASED` |

### 5.5 发展卡

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `PLAY_KNIGHT` | `none` | 拥有骑士，本回合最多使用一张发展卡，非刚购买的卡 | `DEVELOPMENT_CARD_PLAYED`, `LARGEST_ARMY_CHANGED`, `AWAITING_ROBBER_MOVE` |
| `PLAY_ROAD_BUILDING` | `none` | 拥有道路建设卡，允许使用发展卡 | `DEVELOPMENT_CARD_PLAYED`, `AWAITING_FREE_ROAD` |
| `PLACE_FREE_ROAD` | `edgeId` | 处于免费道路状态，边为空且连接合法 | `FREE_ROAD_PLACED` |
| `PLAY_YEAR_OF_PLENTY` | `none` | 拥有丰收之年卡，允许使用发展卡 | `DEVELOPMENT_CARD_PLAYED`, `AWAITING_RESOURCE_CHOICE` |
| `CHOOSE_RESOURCE` | `resource` | 处于丰收之年待选状态，银行资源足够 | `RESOURCE_GAINED`, `HAND_CHANGED` |
| `PLAY_MONOPOLY` | `resource` | 拥有垄断卡，允许使用发展卡 | `DEVELOPMENT_CARD_PLAYED`, `MONOPOLY_RESOLVED` |
| `REVEAL_VICTORY_POINT` | `cardId` | 拥有未公开的胜利点卡 | `VICTORY_POINT_REVEALED`, `VICTORY_POINTS_CHANGED` |

### 5.6 贸易

| Command | 参数 | 主要校验 | 主要事件 |
| --- | --- | --- | --- |
| `TRADE_WITH_BANK` | `give`, `receive` | 港口或银行比率正确，资源足够，银行库存足够 | `BANK_TRADE_COMPLETED`, `HAND_CHANGED` |
| `CREATE_TRADE` | `offer`, `request`, `targetPlayerIds` | 资源足够，交易目标合法 | `TRADE_CREATED` |
| `RESPOND_TO_TRADE` | `tradeId`, `accept` | 当前玩家是目标玩家，交易仍有效 | `TRADE_RESPONSE_RECORDED` |
| `CONFIRM_TRADE` | `tradeId`, `partnerId` | 发起者确认某位接受者，双方资源仍足够 | `TRADE_COMPLETED`, `HAND_CHANGED` |
| `CANCEL_TRADE` | `tradeId` | 当前玩家是发起者，交易未完成 | `TRADE_CANCELLED` |

### 5.7 联机会话命令

这些命令属于房间或传输层，不修改核心游戏规则：

| Command | 说明 |
| --- | --- |
| `JOIN_ROOM` | 加入房间 |
| `LEAVE_ROOM` | 离开房间 |
| `SET_PLAYER_READY` | 设置准备状态 |
| `REQUEST_SYNC` | 请求完整快照 |
| `RECONNECT` | 使用会话令牌恢复连接 |
| `START_GAME` | 由房主启动游戏 |

## 6. Event 总表

### 6.1 生命周期与回合

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `GAME_CREATED` | `PUBLIC` | `gameId`, `options` |
| `BOT_ADDED` | `PUBLIC` | `playerId`, `difficulty` |
| `BOT_REMOVED` | `PUBLIC` | `playerId` |
| `GAME_STARTED` | `PUBLIC` | `players`, `seedCommitment` |
| `BOARD_CREATED` | `PUBLIC` | `hexes`, `vertices`, `edges`, `ports` |
| `PHASE_CHANGED` | `PUBLIC` | `from`, `to` |
| `TURN_STARTED` | `PUBLIC` | `playerId`, `turnNumber` |
| `TURN_ENDED` | `PUBLIC` | `playerId`, `turnNumber` |
| `GAME_ENDED` | `PUBLIC` | `winnerId`, `scores` |

### 6.2 初始放置与建造

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `SETTLEMENT_PLACED` | `PUBLIC` | `playerId`, `vertexId`, `isInitial` |
| `ROAD_PLACED` | `PUBLIC` | `playerId`, `edgeId`, `isInitial`, `isFree` |
| `CITY_PLACED` | `PUBLIC` | `playerId`, `vertexId` |
| `BUILDING_REMOVED` | `PUBLIC` | `reason`, `vertexId` |
| `RESOURCES_SPENT` | `PUBLIC` | `playerId`, `resources` |
| `RESOURCES_GAINED` | `PUBLIC` | `playerId`, `resources`, `source` |
| `HAND_CHANGED` | `PLAYER` | `playerId`, `resources`, `reason` |

### 6.3 骰子、资源与强盗

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `DICE_ROLLED` | `PUBLIC` | `playerId`, `die1`, `die2`, `total` |
| `RESOURCES_PRODUCED` | `PUBLIC` | `hexId`, `resource`, `gains` |
| `BANK_RESOURCE_SHORTAGE` | `PUBLIC` | `resource`, `requested`, `available` |
| `DISCARD_REQUIRED` | `PLAYER` | `playerId`, `count` |
| `RESOURCES_DISCARDED` | `PLAYER` | `playerId`, `resources` |
| `DISCARD_COUNT_CHANGED` | `PUBLIC` | `playerId`, `count` |
| `ROBBER_MOVED` | `PUBLIC` | `hexId`, `movedByPlayerId` |
| `RESOURCE_STOLEN` | `PLAYER` | `victimId`, `thiefId`, `resource` |
| `STEAL_RESOLVED` | `PUBLIC` | `victimId`, `thiefId`, `resourceHidden: true` |

隐藏信息建议拆成两类事件：

- 受害者收到 `RESOURCE_LOST`，知道失去的具体资源。
- 偷取者收到 `RESOURCE_STOLEN`，知道得到的具体资源。
- 其他玩家只收到 `STEAL_RESOLVED`，不知道资源类型。

### 6.4 发展卡与计分

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `DEVELOPMENT_CARD_PURCHASED` | `PUBLIC` | `playerId`, `cardIdHidden: true` |
| `DEVELOPMENT_CARD_DRAWN` | `PLAYER` | `playerId`, `card` |
| `DEVELOPMENT_CARD_PLAYED` | `PUBLIC` | `playerId`, `cardType` |
| `ROAD_BUILDING_STARTED` | `PUBLIC` | `playerId`, `roadsRemaining` |
| `FREE_ROAD_PLACED` | `PUBLIC` | `playerId`, `edgeId`, `roadsRemaining` |
| `YEAR_OF_PLENTY_STARTED` | `PUBLIC` | `playerId`, `choicesRemaining` |
| `MONOPOLY_RESOLVED` | `PUBLIC` | `playerId`, `resource`, `gains` |
| `VICTORY_POINT_REVEALED` | `PUBLIC` | `playerId`, `cardId`, `value` |
| `VICTORY_POINTS_CHANGED` | `PUBLIC` | `playerId`, `value`, `reason` |
| `LONGEST_ROAD_CHANGED` | `PUBLIC` | `previousPlayerId`, `newPlayerId`, `length` |
| `LARGEST_ARMY_CHANGED` | `PUBLIC` | `previousPlayerId`, `newPlayerId`, `size` |

### 6.5 贸易

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `BANK_TRADE_COMPLETED` | `PUBLIC` | `playerId`, `give`, `receive`, `ratio` |
| `TRADE_CREATED` | `PUBLIC` | `tradeId`, `fromPlayerId`, `offer`, `request`, `targets` |
| `TRADE_RESPONSE_RECORDED` | `PUBLIC` | `tradeId`, `playerId`, `accepted` |
| `TRADE_COMPLETED` | `PUBLIC` | `tradeId`, `participants`, `exchange` |
| `TRADE_CANCELLED` | `PUBLIC` | `tradeId`, `playerId` |

### 6.6 错误与同步

| Event | 可见性 | 关键字段 |
| --- | --- | --- |
| `COMMAND_REJECTED` | `PLAYER` | `commandId`, `code`, `message` |
| `STATE_SNAPSHOT` | `PLAYER` | `version`, `playerView` |
| `EVENTS_REPLAYED` | `PLAYER` | `fromVersion`, `events` |
| `PLAYER_DISCONNECTED` | `PUBLIC` | `playerId`, `gracePeriodMs` |
| `PLAYER_RECONNECTED` | `PUBLIC` | `playerId` |
| `BOT_TAKEOVER_STARTED` | `PUBLIC` | `playerId`, `difficulty` |
| `BOT_TAKEOVER_ENDED` | `PUBLIC` | `playerId` |

## 7. 关键动作流程

### 7.1 建造定居点

```text
用户点击交点
  -> UI 检查这是视觉上可选的位置
  -> dispatch(BUILD_SETTLEMENT)
  -> RulesEngine 校验：
     当前阶段
     当前玩家
     节点为空
     距离规则
     道路连接
     资源足够
     剩余定居点数量
  -> 扣除资源
  -> 放置定居点
  -> 更新胜利点
  -> 产生事件
  -> UI 播放动画、更新手牌、写日志
  -> 检查是否达到 10 分
```

### 7.2 掷出点数 7

```text
ROLL_DICE
  -> DICE_ROLLED
  -> 查找手牌超过 7 张的玩家
  -> 若有人超限：
       DISCARD_REQUIRED
       AWAITING_DISCARD
       等待所有玩家 DISCARD_RESOURCES
  -> AWAITING_ROBBER_MOVE
  -> MOVE_ROBBER
  -> 若目标地块旁有多个可偷玩家：
       AWAITING_STEAL_TARGET
       CHOOSE_STEAL_TARGET
  -> 若只有一个：
       自动偷取
  -> TURN_ACTIONS
```

### 7.3 骑士卡

```text
PLAY_KNIGHT
  -> DEVELOPMENT_CARD_PLAYED
  -> 更新最大军队
  -> AWAITING_ROBBER_MOVE
  -> MOVE_ROBBER
  -> 可能进入 AWAITING_STEAL_TARGET
  -> 处理完成后恢复原阶段
```

骑士卡可以在掷骰前或掷骰后使用，因此必须保存 `resumePhase`。

### 7.4 道路建设卡

```text
PLAY_ROAD_BUILDING
  -> AWAITING_FREE_ROAD
  -> PLACE_FREE_ROAD
  -> FREE_ROAD_PLACED
  -> 若剩余道路数大于 0，保持 AWAITING_FREE_ROAD
  -> 否则恢复 TURN_ACTIONS
```

### 7.5 银行贸易

```text
TRADE_WITH_BANK
  -> 根据玩家港口计算最优兑换比率
  -> 校验持有资源和银行库存
  -> 扣除 give
  -> 发放 receive
  -> BANK_TRADE_COMPLETED
  -> HAND_CHANGED
```

### 7.6 玩家间贸易

```text
CREATE_TRADE
  -> TRADE_CREATED
  -> 允许目标玩家 RESPOND_TO_TRADE
  -> 发起者 CONFIRM_TRADE
  -> 再次校验双方资源
  -> 原子交换
  -> TRADE_COMPLETED
```

## 8. Command 校验错误码

| 错误码 | 含义 |
| --- | --- |
| `GAME_NOT_FOUND` | 游戏不存在 |
| `GAME_ALREADY_ENDED` | 游戏已经结束 |
| `NOT_YOUR_TURN` | 不是该玩家回合 |
| `INVALID_PHASE` | 当前阶段不允许该动作 |
| `PLAYER_NOT_FOUND` | 玩家不存在 |
| `INVALID_VERTEX` | 节点不存在 |
| `INVALID_EDGE` | 边不存在 |
| `OCCUPIED_VERTEX` | 节点已有建筑 |
| `OCCUPIED_EDGE` | 边已有道路 |
| `DISTANCE_RULE_VIOLATION` | 违反定居点距离规则 |
| `ROAD_NOT_CONNECTED` | 道路没有连接到己方网络 |
| `RESOURCE_LIMIT_REACHED` | 对应建筑棋子已用完 |
| `INSUFFICIENT_RESOURCES` | 资源不足 |
| `BANK_INSUFFICIENT_RESOURCES` | 银行库存不足 |
| `CARD_NOT_OWNED` | 未持有该发展卡 |
| `CARD_NOT_PLAYABLE` | 本回合不能使用该卡 |
| `ONE_DEV_CARD_PER_TURN` | 本回合已经使用过发展卡 |
| `DISCARD_COUNT_MISMATCH` | 弃牌数量不正确 |
| `TRADE_NOT_FOUND` | 交易不存在 |
| `TRADE_ALREADY_CLOSED` | 交易已经完成或取消 |
| `VERSION_CONFLICT` | 客户端状态版本落后 |
| `DUPLICATE_COMMAND` | 重复命令已经处理 |

## 9. 联机 WebSocket 协议

### 9.1 客户端发送

| 消息 | 说明 |
| --- | --- |
| `join_room` | 加入房间 |
| `leave_room` | 离开房间 |
| `set_ready` | 设置准备 |
| `start_game` | 房主开始游戏 |
| `submit_command` | 提交 `CommandEnvelope` |
| `request_sync` | 请求快照 |
| `reconnect` | 恢复会话 |

### 9.2 服务器发送

| 消息 | 说明 |
| --- | --- |
| `room_state` | 房间玩家和准备状态 |
| `game_started` | 游戏开始，附初始快照 |
| `command_accepted` | 命令接受，附 `version` |
| `command_rejected` | 命令拒绝，附错误码 |
| `game_events` | 本命令产生的事件 |
| `state_snapshot` | 完整玩家视图 |
| `events_replayed` | 增量补发事件 |
| `player_joined` | 玩家加入 |
| `player_disconnected` | 玩家断线 |
| `player_reconnected` | 玩家重连 |
| `game_over` | 游戏结束 |

### 9.3 幂等处理

服务器保存最近处理的 `commandId`。

```text
如果 commandId 已处理：
  返回原 CommandResult
  不再次执行命令

如果 expectedVersion 小于当前版本：
  尝试从事件日志重放
  必要时返回 STATE_SNAPSHOT

如果 expectedVersion 大于当前版本：
  返回 VERSION_CONFLICT
```

## 10. AI 接口

AI 只实现以下接口：

```ts
interface AiPlayer {
  decide(view: PlayerView): Promise<GameCommand>;
}
```

AI 必须通过 `dispatch(command)` 执行动作，不能调用内部状态修改函数。

推荐 AI 决策顺序：

1. 检查必须完成的待处理动作，例如弃牌、移动强盗、选择偷取目标。
2. 评估是否使用发展卡。
3. 评估最佳建造机会。
4. 评估银行贸易。
5. 评估玩家间交易。
6. 结束回合。

## 11. 推荐实现顺序

### P0：游戏骨架

- `START_GAME`
- `PLACE_INITIAL_SETTLEMENT`
- `PLACE_INITIAL_ROAD`
- `ROLL_DICE`
- `END_TURN`
- 基础状态机和玩家视图

### P1：核心建造

- `BUILD_ROAD`
- `BUILD_SETTLEMENT`
- `BUILD_CITY`
- 资源生产、银行库存、胜利点

### P2：强盗和发展卡

- `DISCARD_RESOURCES`
- `MOVE_ROBBER`
- `CHOOSE_STEAL_TARGET`
- `BUY_DEVELOPMENT_CARD`
- 四类主动发展卡
- 最长道路和最大军队

### P3：贸易和完整 AI

- `TRADE_WITH_BANK`
- `CREATE_TRADE`
- `RESPOND_TO_TRADE`
- `CONFIRM_TRADE`
- 完整 AI 策略

### P4：WebSocket 联机

- 房间管理
- 权威服务器
- 幂等命令
- 状态快照
- 事件重放
- 断线重连
- Bot 接管

## 12. 最小验收场景

每个 Command 至少需要以下测试：

1. 合法命令产生预期事件。
2. 非法命令不修改状态。
3. 重复命令不重复执行。
4. 状态版本按顺序递增。
5. 每个玩家只能看到自己有权限看到的信息。
6. 相同随机种子产生相同结果。
7. 事件重放后的状态与原始状态一致。
8. 断线客户端使用快照和增量事件后能恢复一致状态。

