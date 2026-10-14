(function() {
  "use strict";
  const __modules = {
"debug/app.js": function(module, exports, __require) {
const { AI_DIFFICULTIES: AI_DIFFICULTIES, chooseBotCommand: chooseBotCommand } = __require("src/bots/heuristic-bot.js");
const { BUILD_COSTS: BUILD_COSTS, GAME_PHASES: GAME_PHASES, PIECE_LIMITS: PIECE_LIMITS, RESOURCE_ICONS: RESOURCE_ICONS, RESOURCE_LABELS: RESOURCE_LABELS, RESOURCES: RESOURCES, SETUP_STEPS: SETUP_STEPS } = __require("src/core/constants.js");
const { LocalGameSession: LocalGameSession } = __require("src/core/session.js");
const { RemoteGameSession: RemoteGameSession } = __require("src/network/remote-session.js");
const { createSoundLayer: createSoundLayer } = __require("debug/sound.js");

/* 音效层（实现见 debug/sound.js）。挂在 window 上只是为了自测时能读它的 log。 */
const sound = createSoundLayer();
window.cataniaSound = sound;

const TERRAIN_COLORS = {
  /* 莫兰迪大地色：与 debug/skin-parchment.css 里的地形纹样配套 */
  forest: "#6e8570",
  hills: "#b0846a",
  pasture: "#a6b27f",
  fields: "#c7b776",
  mountains: "#8c8a8c",
  desert: "#d7ceb2",
};

const RESOURCE_MARKS = {
  wood: "木",
  brick: "砖",
  sheep: "羊",
  wheat: "麦",
  ore: "矿",
};

/* 港口牌：立在海岸边中点、沿这条边的外法线朝外。
   文字是主信息（资源单字 + 兑换比例），不配图标——图标缩到那么小认不出是哪种资源。
   牌面离海岸留固定的一小段，这段由桅杆画出来；留白固定而不是牌心固定，
   否则宽牌（"砖2:1"）会顶到海岸、把桅杆整根盖住，看着就像缺了那截短横线。
   尺寸单位都是 SVG 用户单位，棋盘 viewBox 只有 10 个单位宽，改这几个数要一起看。 */
const HARBOR_POST = 0.14;
const HARBOR_PLATE_H = 0.3;
const HARBOR_FONT = 0.18;
const HARBOR_PAD = 0.12;
const HARBOR_ADVANCE = 0.56;
const HARBOR_PLATE_MAX_W = 0.68;

function harborPlateWidth(label) {
  /* 汉字按全角、其余按半角估宽，只用来给牌面留左右内边距 */
  let units = 0;
  for (const character of label) {
    units += character.charCodeAt(0) > 0x2e80 ? 1 : HARBOR_ADVANCE;
  }
  return Math.min(HARBOR_PLATE_MAX_W, units * HARBOR_FONT + HARBOR_PAD);
}

const PHASE_LABELS = {
  [GAME_PHASES.LOBBY]: "等待开始",
  [GAME_PHASES.SETUP_ROUND_1]: "初始放置：第一轮",
  [GAME_PHASES.SETUP_ROUND_2]: "初始放置：第二轮",
  [GAME_PHASES.AWAITING_ROLL]: "等待掷骰",
  [GAME_PHASES.TURN_ACTIONS]: "回合行动",
  [GAME_PHASES.AWAITING_DISCARD]: "等待弃牌",
  [GAME_PHASES.AWAITING_ROBBER_MOVE]: "移动强盗",
  [GAME_PHASES.AWAITING_STEAL_TARGET]: "选择偷取对象",
  [GAME_PHASES.AWAITING_FREE_ROAD]: "放置免费道路",
  [GAME_PHASES.AWAITING_RESOURCE_CHOICE]: "选择资源",
  [GAME_PHASES.GAME_OVER]: "游戏结束",
};

const DEVELOPMENT_CARD_LABELS = {
  knight: "骑士",
  victoryPoint: "胜利点",
  roadBuilding: "道路建设",
  yearOfPlenty: "丰收之年",
  monopoly: "垄断",
};

const boardElement = document.querySelector("#board");
const completionElement = document.querySelector("#completion");
const phaseElement = document.querySelector("#phase");
const currentPlayerElement = document.querySelector("#current-player");
const actionHintElement = document.querySelector("#action-hint");
const turnStatusElement = document.querySelector("#turn-status");
const turnTimerElement = document.querySelector("#turn-timer");
const turnPillElement = document.querySelector(".turn-pill");
const diceDisplayElement = document.querySelector("#dice-display");
const rollDiceButton = document.querySelector("#roll-dice");
const endTurnButton = document.querySelector("#end-turn");
const buildRoadButton = document.querySelector("#build-road");
const buildSettlementButton = document.querySelector("#build-settlement");
const buildCityButton = document.querySelector("#build-city");
const buildHintElement = document.querySelector("#build-hint");
const discardControlsElement = document.querySelector("#discard-controls");
const discardSummaryElement = document.querySelector("#discard-summary");
const discardResourceListElement = document.querySelector("#discard-resource-list");
const confirmDiscardButton = document.querySelector("#confirm-discard");
const stealControlsElement = document.querySelector("#steal-controls");
const stealPlayerListElement = document.querySelector("#steal-player-list");
const developmentControlsElement = document.querySelector("#development-controls");
const developmentSummaryElement = document.querySelector("#development-summary");
const buyDevelopmentCardButton = document.querySelector("#buy-development-card");
const devHandDockElement = document.querySelector("#dev-hand-dock");
const devHandHintElement = document.querySelector("#dev-hand-hint");
const resourceChoiceControlsElement = document.querySelector(
  "#resource-choice-controls",
);
const resourceChoiceListElement = document.querySelector("#resource-choice-list");
const tradeControlsElement = document.querySelector("#trade-controls");
const tradeSummaryElement = document.querySelector("#trade-summary");
const tradeActionListElement = document.querySelector("#trade-action-list");
const bankTradeFormElement = document.querySelector("#bank-trade-form");
const bankGiveResourceSelect = document.querySelector("#bank-give-resource");
const bankReceiveResourceSelect = document.querySelector("#bank-receive-resource");
const bankTradeButton = document.querySelector("#bank-trade-button");
const tradeDialogElement = document.querySelector("#trade-dialog");
const openTradeDialogButton = document.querySelector("#open-trade-dialog");
const closeTradeDialogButton = document.querySelector("#close-trade-dialog");
const clearTradeDraftButton = document.querySelector("#clear-trade-draft");
const tradeBuilderElement = document.querySelector("#trade-builder");
const createTradeButton = document.querySelector("#create-trade-button");
const playersElement = document.querySelector("#players");
const playerCountElement = document.querySelector("#player-count");
const handDockElement = document.querySelector("#hand-dock");
const eventLogElement = document.querySelector("#event-log");
const openMatchHistoryButton = document.querySelector("#open-match-history");
const openReplayButton = document.querySelector("#open-replay");
const historyStatusElement = document.querySelector("#history-status");
const matchHistorySummaryElement = document.querySelector(
  "#match-history-summary",
);
const replayDialogElement = document.querySelector("#replay-dialog");
const closeReplayButton = document.querySelector("#close-replay");
const replayMetaElement = document.querySelector("#replay-meta");
const replayEventDetailElement = document.querySelector(
  "#replay-event-detail",
);
const replayEventListElement = document.querySelector("#replay-event-list");
const replayRangeElement = document.querySelector("#replay-range");
const replayPrevButton = document.querySelector("#replay-prev");
const replayToggleButton = document.querySelector("#replay-toggle");
const replayNextButton = document.querySelector("#replay-next");
const playerNameInput = document.querySelector("#player-name");
const botCountSelect = document.querySelector("#bot-count");
const botDifficultySelect = document.querySelector("#bot-difficulty");
const newGameButton = document.querySelector("#new-game");
const onlineStatusElement = document.querySelector("#online-status");
const netStatusElement = document.querySelector("#net-status");
const netStatusTextElement = document.querySelector("#net-status-text");
const netToastElement = document.querySelector("#net-toast");
const boardTooltipElement = document.querySelector("#board-tooltip");

/* ---------- 网络状态与提示 ----------
   右上角那颗小牌子反映 WebSocket 的连接状态；
   掉线时浮一条提示，重连成功后自动收掉。 */
const NET_STATES = {
  local: "本地对局",
  connecting: "连接中",
  online: "连接正常",
  reconnecting: "重连中",
  offline: "已断开",
};

let netToastTimer = null;

function setNetStatus(state, detail = "") {
  if (!netStatusElement) return;
  const label = NET_STATES[state] || state;
  netStatusElement.dataset.state = state;
  if (netStatusTextElement) {
    netStatusTextElement.textContent = detail ? `${label} · ${detail}` : label;
  }
}

function showNetToast(text, kind = "warn", autoHide = 0) {
  if (!netToastElement) return;
  netToastElement.textContent = text;
  netToastElement.className = `net-toast notice notice--${kind}`;
  netToastElement.hidden = false;
  if (netToastTimer) clearTimeout(netToastTimer);
  if (autoHide > 0) {
    netToastTimer = setTimeout(() => {
      netToastElement.hidden = true;
    }, autoHide);
  }
}

function hideNetToast() {
  if (!netToastElement) return;
  if (netToastTimer) clearTimeout(netToastTimer);
  netToastTimer = null;
  netToastElement.hidden = true;
}

/** 提示条：普通用墨色，成功墨绿，出错封蜡红。 */
function setActionHint(text, kind = "") {
  actionHintElement.textContent = text;
  actionHintElement.classList.toggle("is-ok", kind === "ok");
  actionHintElement.classList.toggle("is-error", kind === "error");
  if (kind === "error") sound.play("error");
}

/* 棋盘悬浮提示：读元素上的 data-tip 自绘一块羊皮纸。
   定位只用 transform，不碰 left/top —— 每帧改 left/top 会触发布局，
   鼠标扫过棋盘时最容易卡在这里。 */
let boardTipText = "";
let boardTipWidth = 0;

function moveBoardTip(event) {
  if (!boardTooltipElement) return;
  const node = event.target?.closest?.("[data-tip]");
  const text = node ? node.dataset.tip || "" : "";
  if (!text) {
    hideBoardTip();
    return;
  }
  if (text !== boardTipText) {
    boardTipText = text;
    boardTooltipElement.textContent = text;
    boardTooltipElement.hidden = false;
    boardTipWidth = boardTooltipElement.offsetWidth;
  }
  const flip = event.clientX + boardTipWidth + 24 > window.innerWidth;
  const x = flip ? event.clientX - boardTipWidth - 14 : event.clientX + 14;
  boardTooltipElement.style.transform = `translate3d(${x}px, ${event.clientY + 16}px, 0)`;
}

function hideBoardTip() {
  if (!boardTooltipElement) return;
  boardTooltipElement.hidden = true;
  boardTipText = "";
}

const onlineRoomIdInput = document.querySelector("#online-room-id");
const onlinePlayerNameInput = document.querySelector("#online-player-name");
const connectOnlineButton = document.querySelector("#connect-online");
const createRoomButton = document.querySelector("#create-room");
const spectateOnlineButton = document.querySelector("#spectate-online");
const onlineEntryElement = document.querySelector("#online-entry");
const onlineRoomViewElement = document.querySelector("#online-room-view");
const onlineSeatsElement = document.querySelector("#online-seats");
const onlineSpectatorsElement = document.querySelector("#online-spectators");
const onlineStartButton = document.querySelector("#online-start");
const onlinePlayerControlsElement = document.querySelector(
  "#online-player-controls",
);
const onlineSpectatorControlsElement = document.querySelector(
  "#online-spectator-controls",
);
const createRoomDialogElement = document.querySelector("#create-room-dialog");
const createRoomIdInput = document.querySelector("#create-room-id");
const createRoomPlayersSelect = document.querySelector("#create-room-players");
const createRoomBotsSelect = document.querySelector("#create-room-bots");
const createRoomDifficultySelect = document.querySelector(
  "#create-room-difficulty",
);
const createRoomTimerSelect = document.querySelector("#create-room-timer");
const createRoomMaxSpectatorsInput = document.querySelector(
  "#create-room-max-spectators",
);
const createRoomAllowSpectatorsInput = document.querySelector(
  "#create-room-allow-spectators",
);
const createRoomAllowTakeoverInput = document.querySelector(
  "#create-room-allow-takeover",
);
const confirmCreateRoomButton = document.querySelector("#confirm-create-room");
const cancelCreateRoomButton = document.querySelector("#cancel-create-room");
const closeCreateRoomButton = document.querySelector("#close-create-room");
const onlineRoomIdValueElement = document.querySelector("#online-room-id-value");
const onlineRoomHintElement = document.querySelector("#online-room-hint");
const copyRoomIdButton = document.querySelector("#copy-room-id");
const placementConfirmElement = document.querySelector("#placement-confirm");
const actionPlaceholderElement = document.querySelector("#action-placeholder");
const boardResetButton = document.querySelector("#board-reset");
const boardHelpButton = document.querySelector("#board-help");
const helpDialogElement = document.querySelector("#help-dialog");
const closeHelpButton = document.querySelector("#close-help");
const toggleSidebarButton = document.querySelector("#toggle-sidebar");
const closeSidebarButton = document.querySelector("#close-sidebar");
const sidebarTabButtons = [...document.querySelectorAll("[data-sidebar-tab]")];
const sidebarViews = new Map(
  ["table", "room", "log"].map((tab) => [
    tab,
    document.querySelector(`#sidebar-${tab}`),
  ]),
);
const boardCanvasElement = document.querySelector(".board-canvas");
const boardStageElement = document.querySelector(".board-stage");

let session = null;
let botTimer = null;
let selectedBuild = null;
let discardSelection = null;
let HUMAN_ID = 0;
let onlineSession = null;
let onlineRoom = null;
let onlineSelf = null;
let isSpectating = false;
/* 这两条被 startNewGame / connectOnline 用到，而那些函数在模块顶层就可能被调用
   （?mode=solo 走 setTimeout、?debugAutostart=1 直接同步调），
   所以声明必须放在这里 —— 放到文件后面的「创建房间」那一段会踩 TDZ：
   顶层一抛错，后面的监听器全都注册不上。 */
let pendingRoomSetup = null;
/* 座位表显示几行：房主创建时选的人数；别人加入时按已坐座位推断。
   服务端一张桌子固定 4 个座位，这个只是前端的显示约定。 */
let roomTableSize = null;
/* 落子二次确认里待执行的命令。renderBoard() 第一句就会调 closePlacementConfirm()，
   而 render() 在模块初始化阶段就可能跑（?debugAutostart=1），所以它同样得声明在这里。 */
let pendingPlacement = null;
let lastView = null;
/* 和 CSS 的 --motion-* / --ease-* 一一对应。
   JS 驱动的动画必须和样式里那条动画同时长 —— pulseClass 是按时长把类摘掉的，
   两边对不上就会出现"动画还在跑，类已经被摘了"的腰斩。 */
const MOTION = {
  quick: 120,
  base: 240,
  stamp: 320,
  rise: 420,
  beat: 520,
  carry: 620,
  hold: 760,
  lift: 1100,
  /* 跨区域的搬运：飞牌要慢到看得清是什么，收线只要一段回程 */
  fly: 820,
  reel: 460,
  ease: {
    soft: "cubic-bezier(0.3, 0.7, 0.3, 1)",
    out: "cubic-bezier(0.22, 0.8, 0.3, 1)",
    inout: "cubic-bezier(0.4, 0.1, 0.6, 1)",
  },
};
/* 落子三态：候选点 hover 时把“放下去长什么样”画进 preview-layer，
   点过一次的候选点钉在原地等确认牌（见 appendPlacementMarker / bindPlacementMarker）。 */
let placementPreviewLayer = null;
let placementPreviewOwner = null;
let pinnedPlacementMarker = null;
let replayData = null;
let replayIndex = 0;
let replayTimer = null;
let matchHistory = [];
setInterval(() => {
  if (!session || session.isRemote || botTimer) return;
  const actorId = getBotActorId();
  if (actorId === undefined || actorId === null) return;
  if (session.state.players[actorId]?.isBot) scheduleBotTurn();
}, 1000);
setInterval(renderTurnTimer, 250);
const boardView = {
  scale: 1,
  x: 0,
  y: 0,
  dragging: false,
  draggingMoved: false,
  suppressClick: false,
  pointerX: 0,
  pointerY: 0,
};
let lastRenderedSequence = -1;
let boardRenderKey = "";
const tradeDraft = {
  offer: Object.fromEntries(RESOURCES.map((resource) => [resource, 0])),
  request: Object.fromEntries(RESOURCES.map((resource) => [resource, 0])),
};
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/* ---------- 音效接线 ----------
   声音只有一个入口：事件动画（animateEvents）、全局按钮委托、弹窗 hidden 变化。
   别在各个功能里零散地撒 sound.play(...)，否则以后加一个音要翻十个文件。 */
document.addEventListener("pointerdown", () => sound.unlock(), true);
document.addEventListener("keydown", () => sound.unlock(), true);
document.addEventListener("click", (event) => {
  const button = event.target?.closest?.("button");
  if (button && !button.disabled) sound.play("click");
});

const soundToggleButton = document.querySelector("#sound-toggle");
const soundToggleUse = soundToggleButton?.querySelector("use");

function renderSoundToggle() {
  if (!soundToggleButton) return;
  const muted = sound.isMuted();
  soundToggleButton.setAttribute("aria-pressed", muted ? "false" : "true");
  soundToggleButton.title = muted ? "音效：关" : "音效：开";
  soundToggleUse?.setAttribute("href", muted ? "#icon-sound-off" : "#icon-sound-on");
}

soundToggleButton?.addEventListener("click", () => {
  sound.setMuted(!sound.isMuted());
  renderSoundToggle();
});
renderSoundToggle();

/* 弹窗开合音：盯 hidden 的变化，覆盖点遮罩、Esc、按钮所有关闭路径 */
const dialogVoices = new Map([
  [helpDialogElement, { open: "open", close: "close" }],
  [replayDialogElement, { open: "open", close: "close" }],
  [createRoomDialogElement, { open: "open", close: "close" }],
  [tradeDialogElement, { open: "open", close: "close" }],
  /* 结算面板同时兼任「初始放置完成」的横幅，所以这里只给开合音，
     真正的胜利音在 renderCompletion 判定 GAME_OVER 时单独放。 */
  [completionElement, { open: "open", close: "close" }],
]);
const dialogHiddenState = new Map();
const dialogObserver = new MutationObserver(() => {
  for (const [element, voices] of dialogVoices) {
    const hidden = element.classList.contains("hidden");
    if (dialogHiddenState.get(element) === hidden) continue;
    dialogHiddenState.set(element, hidden);
    const voice = hidden ? voices.close : voices.open;
    if (voice) sound.play(voice);
  }
});
for (const element of dialogVoices.keys()) {
  dialogHiddenState.set(element, element.classList.contains("hidden"));
  dialogObserver.observe(element, { attributes: true, attributeFilter: ["class"] });
}

newGameButton.addEventListener("click", startNewGame);
rollDiceButton.addEventListener("click", () => dispatchHuman({ type: "ROLL_DICE" }));
endTurnButton.addEventListener("click", () => dispatchHuman({ type: "END_TURN" }));
buildRoadButton.addEventListener("click", () => selectBuild("road"));
buildSettlementButton.addEventListener("click", () => selectBuild("settlement"));
buildCityButton.addEventListener("click", () => selectBuild("city"));
confirmDiscardButton.addEventListener("click", confirmDiscard);
buyDevelopmentCardButton.addEventListener("click", () =>
  dispatchHuman({ type: "BUY_DEVELOPMENT_CARD" }),
);
bankTradeButton.addEventListener("click", executeSelectedBankTrade);
createTradeButton.addEventListener("click", () => {
  executeSelectedPlayerTrade();
  closeTradeDialog();
});
openTradeDialogButton.addEventListener("click", () => {
  /* 先 render 一次：弹窗里的步进器上限要按最新手牌来，别拿上一帧的 */
  if (session) render();
  openTradeDialog();
});
closeTradeDialogButton.addEventListener("click", closeTradeDialog);
clearTradeDraftButton.addEventListener("click", () => {
  resetTradeDraft();
  if (session) render();
});
tradeDialogElement.addEventListener("click", (event) => {
  if (event.target === tradeDialogElement) closeTradeDialog();
});
for (const element of [bankGiveResourceSelect, bankReceiveResourceSelect]) {
  element.addEventListener("change", () => {
    if (session) render();
  });
}
connectOnlineButton.addEventListener("click", () => {
  /* 手动连接不要带上「创建房间」那边还没用掉的配置 */
  pendingRoomSetup = null;
  connectOnline("player");
});
spectateOnlineButton.addEventListener("click", () => {
  pendingRoomSetup = null;
  connectOnline("spectator");
});
createRoomButton.addEventListener("click", openCreateRoomDialog);
createRoomDialogElement.addEventListener("click", (event) => {
  /* 点遮罩关闭，和帮助弹窗一个手感 */
  if (event.target === createRoomDialogElement) closeCreateRoomDialog();
});
createRoomIdInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") confirmCreateRoom();
});
createRoomPlayersSelect.addEventListener("change", syncCreateRoomBotOptions);
confirmCreateRoomButton.addEventListener("click", confirmCreateRoom);
cancelCreateRoomButton.addEventListener("click", closeCreateRoomDialog);
closeCreateRoomButton.addEventListener("click", closeCreateRoomDialog);
copyRoomIdButton.addEventListener("click", copyRoomId);
onlineStartButton.addEventListener("click", () => onlineSession?.startGame());
boardResetButton.addEventListener("click", () => {
  selectedBuild = null;
  discardSelection = null;
  resetBoardView();
  render();
});
boardHelpButton.addEventListener("click", () => helpDialogElement.classList.remove("hidden"));
closeHelpButton.addEventListener("click", () => helpDialogElement.classList.add("hidden"));
openMatchHistoryButton.addEventListener("click", requestMatchHistoryView);
openReplayButton.addEventListener("click", requestReplayView);
closeReplayButton.addEventListener("click", closeReplayDialog);
replayPrevButton.addEventListener("click", () => setReplayIndex(replayIndex - 1));
replayNextButton.addEventListener("click", () => setReplayIndex(replayIndex + 1));
replayToggleButton.addEventListener("click", toggleReplayPlayback);
replayRangeElement.addEventListener("input", () =>
  setReplayIndex(Number(replayRangeElement.value)),
);
helpDialogElement.addEventListener("click", (event) => {
  if (event.target === helpDialogElement) helpDialogElement.classList.add("hidden");
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    helpDialogElement.classList.add("hidden");
    closeReplayDialog();
    closePlacementConfirm();
    closeTradeDialog();
  }
});
toggleSidebarButton.addEventListener("click", toggleSidebar);
closeSidebarButton.addEventListener("click", toggleSidebar);
for (const button of sidebarTabButtons) {
  button.addEventListener("click", () => {
    setSidebarTab(button.dataset.sidebarTab);
  });
}
boardCanvasElement.addEventListener("wheel", handleBoardWheel, { passive: false });
boardCanvasElement.addEventListener("pointerdown", handleBoardPointerDown);
boardCanvasElement.addEventListener("pointermove", handleBoardPointerMove);
boardCanvasElement.addEventListener("pointermove", moveBoardTip);
boardCanvasElement.addEventListener("pointerleave", hideBoardTip);
boardCanvasElement.addEventListener("pointerdown", hideBoardTip);
boardCanvasElement.addEventListener("pointerup", handleBoardPointerUp);
boardCanvasElement.addEventListener("pointercancel", handleBoardPointerUp);
boardCanvasElement.addEventListener("dblclick", resetBoardView);
boardCanvasElement.addEventListener(
  "click",
  (event) => {
    if (!boardView.suppressClick) return;
    boardView.suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  },
  true,
);
document.addEventListener("keydown", handleKeyboardShortcut);

if (localStorage.getItem("catania-sidebar-collapsed") === "1") {
  document.body.classList.add("sidebar-collapsed");
  toggleSidebarButton.textContent = "展开侧栏";
}
setNetStatus("local");
const guestId = getOrCreateGuestId();
const initialUrlParams = new URLSearchParams(location.search);
const roomFromUrl = initialUrlParams.get("room");
if (roomFromUrl) {
  onlineRoomIdInput.value = roomFromUrl;
  if (initialUrlParams.get("spectate") === "1") {
    connectOnline("spectator");
  } else if (localStorage.getItem(`catania-reconnect-${roomFromUrl}`)) {
    connectOnline("player");
  }
}
if (new URLSearchParams(location.search).get("debugAutostart") === "1") {
  /* 必须延后执行：startNewGame 会一路调到 render()，而 render() 用到
     RESOURCE_GLYPHS / DICE_PIPS / placementConfirmElement 这些声明在文件后半段的常量，
     在模块顶层同步调用会撞 TDZ（整块棋盘都画不出来）。
     和上面的 applyLaunchMode 一样丢给 setTimeout，等模块全部执行完再启动。 */
  window.setTimeout(startNewGame, 0);
}

function startNewGame() {
  if (botTimer) clearTimeout(botTimer);
  botTimer = null;
  selectedBuild = null;
  discardSelection = null;
  if (onlineSession) onlineSession.close();
  onlineSession = null;
  onlineRoom = null;
  onlineSelf = null;
  isSpectating = false;
  roomTableSize = null;
  pendingRoomSetup = null;
  HUMAN_ID = 0;
  onlineStatusElement.textContent = "未连接";
  renderOnlineLobby();
  setSidebarTab("table");

  const botCount = Number(botCountSelect.value);
  const players = [
    { name: playerNameInput.value.trim() || "玩家", isBot: false },
    ...Array.from({ length: botCount }, (_, index) => ({
      name: ["Ada", "Bjorn", "Cleo"][index] || `AI ${index + 1}`,
      isBot: true,
      difficulty: botDifficultySelect.value,
    })),
  ];

  session = new LocalGameSession({
    players,
    seed: Date.now(),
    gameId: `debug-${Date.now().toString(36)}`,
  });
  session.subscribe(render);
  session.start(HUMAN_ID);
  const debugParams = new URLSearchParams(location.search);
  if (debugParams.get("debugAiTrade") === "1") {
    setupDebugAiTrade(session);
  } else if (debugParams.get("debugTradeBuilder") === "1") {
    setupDebugTradeBuilder(session);
  }
  render();
  scheduleBotTurn();
}

function setupDebugAiTrade(currentSession) {
  let steps = 0;
  while (
    (currentSession.phase === GAME_PHASES.SETUP_ROUND_1 ||
      currentSession.phase === GAME_PHASES.SETUP_ROUND_2) &&
    steps < 100
  ) {
    const actorId = currentSession.state.currentPlayerId;
    const view = currentSession.getView(actorId);
    const command = chooseBotCommand(view, "hard", () => 0);
    if (!command) break;
    currentSession.dispatch(actorId, command);
    steps += 1;
  }

  currentSession.state.phase = GAME_PHASES.TURN_ACTIONS;
  currentSession.state.currentPlayerId = 1;
  currentSession.state.turn.hasRolled = true;
  currentSession.state.turn.dice = { die1: 2, die2: 3, total: 5 };
  currentSession.state.players[1].resources.wheat = 2;
  currentSession.state.players[0].resources.brick = 1;
  currentSession.dispatch(1, {
    type: "CREATE_TRADE",
    offer: { wheat: 1 },
    request: { brick: 1 },
    targetPlayerIds: [0, 2, 3],
  });
}

function setupDebugTradeBuilder(currentSession) {
  let steps = 0;
  while (
    (currentSession.phase === GAME_PHASES.SETUP_ROUND_1 ||
      currentSession.phase === GAME_PHASES.SETUP_ROUND_2) &&
    steps < 100
  ) {
    const actorId = currentSession.state.currentPlayerId;
    const view = currentSession.getView(actorId);
    const command = chooseBotCommand(view, "hard", () => 0);
    if (!command) break;
    currentSession.dispatch(actorId, command);
    steps += 1;
  }

  currentSession.state.phase = GAME_PHASES.TURN_ACTIONS;
  currentSession.state.currentPlayerId = 0;
  currentSession.state.turn.hasRolled = true;
  currentSession.state.turn.dice = { die1: 2, die2: 3, total: 5 };
  currentSession.state.players[0].resources = {
    wood: 2,
    brick: 2,
    sheep: 1,
    wheat: 1,
    ore: 1,
  };
}

function resetBoardView() {
  boardView.scale = 1;
  boardView.x = 0;
  boardView.y = 0;
  applyBoardView();
}

function applyBoardView() {
  boardElement.style.transform = `translate(${boardView.x}px, ${boardView.y}px) scale(${boardView.scale})`;
}

function handleBoardWheel(event) {
  event.preventDefault();
  const rect = boardCanvasElement.getBoundingClientRect();
  const pointerX = event.clientX - rect.left - rect.width / 2;
  const pointerY = event.clientY - rect.top - rect.height / 2;
  const previousScale = boardView.scale;
  const nextScale = Math.min(2.4, Math.max(0.75, previousScale * (event.deltaY > 0 ? 0.9 : 1.1)));
  const ratio = nextScale / previousScale;
  boardView.x = pointerX - (pointerX - boardView.x) * ratio;
  boardView.y = pointerY - (pointerY - boardView.y) * ratio;
  boardView.scale = nextScale;
  applyBoardView();
}

function handleBoardPointerDown(event) {
  if (event.button !== 0) return;
  if (isBoardInteractiveTarget(event.target)) return;
  boardView.dragging = true;
  boardView.draggingMoved = false;
  boardView.pointerX = event.clientX;
  boardView.pointerY = event.clientY;
  boardCanvasElement.setPointerCapture(event.pointerId);
}

function isBoardInteractiveTarget(target) {
  return Boolean(
    target?.closest?.(
      ".valid-target, .valid-road-target, .robber-target, .settlement, .road",
    ),
  );
}

function handleBoardPointerMove(event) {
  if (!boardView.dragging) return;
  boardView.x += event.clientX - boardView.pointerX;
  boardView.y += event.clientY - boardView.pointerY;
  if (Math.abs(event.clientX - boardView.pointerX) + Math.abs(event.clientY - boardView.pointerY) > 2) {
    boardView.draggingMoved = true;
  }
  boardView.pointerX = event.clientX;
  boardView.pointerY = event.clientY;
  applyBoardView();
}

function handleBoardPointerUp(event) {
  if (!boardView.dragging) return;
  boardView.dragging = false;
  boardView.suppressClick = boardView.draggingMoved;
  if (boardCanvasElement.hasPointerCapture(event.pointerId)) {
    boardCanvasElement.releasePointerCapture(event.pointerId);
  }
}

function toggleSidebar() {
  const collapsed = document.body.classList.toggle("sidebar-collapsed");
  toggleSidebarButton.textContent = collapsed ? "展开侧栏" : "收起侧栏";
  localStorage.setItem("catania-sidebar-collapsed", collapsed ? "1" : "0");
}

function setSidebarTab(tabName) {
  if (!sidebarViews.has(tabName)) return;
  for (const [name, view] of sidebarViews) {
    view?.classList.toggle("hidden", name !== tabName);
  }
  for (const button of sidebarTabButtons) {
    const active = button.dataset.sidebarTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
}

function handleKeyboardShortcut(event) {
  if (isSpectating) return;
  const tagName = event.target?.tagName?.toLowerCase();
  if (["input", "select", "textarea"].includes(tagName)) return;

  if (event.key === "r" || event.key === "R") {
    if (!rollDiceButton.disabled) {
      event.preventDefault();
      dispatchHuman({ type: "ROLL_DICE" });
    }
    return;
  }
  if (event.key === "e" || event.key === "E") {
    if (!endTurnButton.disabled) {
      event.preventDefault();
      dispatchHuman({ type: "END_TURN" });
    }
    return;
  }
  if (event.code === "Space") {
    if (!rollDiceButton.disabled) {
      event.preventDefault();
      dispatchHuman({ type: "ROLL_DICE" });
    } else if (!endTurnButton.disabled) {
      event.preventDefault();
      dispatchHuman({ type: "END_TURN" });
    }
    return;
  }
  if (event.key === "1" && !buildRoadButton.disabled) {
    selectBuild("road");
    return;
  }
  if (event.key === "2" && !buildSettlementButton.disabled) {
    selectBuild("settlement");
    return;
  }
  if (event.key === "3" && !buildCityButton.disabled) {
    selectBuild("city");
    return;
  }
  if (event.key === "Escape") {
    selectedBuild = null;
    render();
  }
}

/* ---------- 创建房间 ----------
   面板里只留「连接服务器 / 创建房间」两个入口，人数、人机难度、观战、计时
   这些配置都挪进独立弹窗。确认后仍走原来的连接流程，进房之后由下面这次
   一次性下发把配置补齐——协议不动，只用现成的
   update_room_settings / add_bot / set_ready 三条消息。 */

function visibleSeatCount(room) {
  const occupiedMax = room.seats.reduce(
    (max, seat) => (seat.kind ? Math.max(max, seat.seatId) : max),
    -1,
  );
  const base = Number.isInteger(roomTableSize) ? roomTableSize : Math.max(3, occupiedMax + 1);
  /* 有人坐进来就要显示出来，所以至少要盖住最后一个已占座位 */
  return Math.min(room.seats.length, Math.max(base, occupiedMax + 1));
}

function randomRoomId() {
  return `catan-${Math.random().toString(36).slice(2, 8)}`;
}

function openCreateRoomDialog() {
  createRoomIdInput.value = randomRoomId();
  syncCreateRoomBotOptions();
  createRoomDialogElement.classList.remove("hidden");
  createRoomIdInput.focus();
  createRoomIdInput.select();
}

/* 人机数量的可选项跟着「玩家数量」走：座位是固定的 4 个，
   填不满的人机位就空着，留给真人用同一个房间号进来。 */
function syncCreateRoomBotOptions() {
  const playerCount = Number(createRoomPlayersSelect.value) || 4;
  const maxBots = Math.max(0, playerCount - 1);
  /* 第一次进来选择框还是空的，按「坐满」给默认值 */
  const raw = createRoomBotsSelect.value;
  const previous = raw === "" ? Number.NaN : Number(raw);
  const keep =
    Number.isInteger(previous) && previous >= 0 && previous <= maxBots
      ? previous
      : maxBots;
  const options = [];
  for (let count = 0; count <= maxBots; count += 1) {
    options.push({ value: String(count), label: `${count} 个` });
  }
  createRoomBotsSelect.replaceChildren(
    ...options.map(({ value, label }) => new Option(label, value)),
  );
  createRoomBotsSelect.value = String(keep);
}

async function copyRoomId() {
  if (!onlineRoom) return;
  try {
    await navigator.clipboard.writeText(onlineRoom.id);
    copyRoomIdButton.textContent = "已复制";
  } catch (error) {
    copyRoomIdButton.textContent = "复制失败";
  }
  window.setTimeout(() => {
    copyRoomIdButton.textContent = "复制";
  }, 1400);
}

function closeCreateRoomDialog() {
  createRoomDialogElement.classList.add("hidden");
}

function confirmCreateRoom() {
  const roomId = createRoomIdInput.value.trim() || randomRoomId();
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(roomId)) {
    setActionHint("房间号只能用字母、数字、下划线和短横线，长度 1-40。", "error");
    createRoomIdInput.focus();
    return;
  }
  pendingRoomSetup = {
    /* 只补人机、不补满：剩下的座位留给真人，用同一个房间号进来。
       服务端一张桌子固定 4 个座位，且接受 3 或 4 人开局。 */
    botCount: Math.max(0, Number(createRoomBotsSelect.value) || 0),
    /* 这里选的人数决定座位表显示几行（服务端没有这个概念，是前端自己的约定） */
    tableSize: Math.min(4, Math.max(3, Number(createRoomPlayersSelect.value) || 4)),
    difficulty: createRoomDifficultySelect.value,
    turnTimerMs: Number(createRoomTimerSelect.value),
    maxSpectators: Number(createRoomMaxSpectatorsInput.value),
    allowSpectators: createRoomAllowSpectatorsInput.checked,
    allowBotTakeover: createRoomAllowTakeoverInput.checked,
  };
  closeCreateRoomDialog();
  onlineRoomIdInput.value = roomId;
  onlineStatusElement.textContent = "正在创建房间";
  connectOnline("player");
}

/* 进房后下发一次创建配置：只有房主、只在等待开始时、只发一次 */
function applyPendingRoomSetup() {
  if (!pendingRoomSetup || !onlineSession || !onlineRoom) return;
  if (onlineRoom.hostClientId !== onlineSession.clientId) return;
  if (onlineRoom.status !== "LOBBY") return;
  const setup = pendingRoomSetup;
  pendingRoomSetup = null;
  roomTableSize = setup.tableSize;
  onlineSession.updateRoomSettings({
    turnTimerMs: setup.turnTimerMs,
    maxSpectators: setup.maxSpectators,
    allowSpectators: setup.allowSpectators,
    allowBotTakeover: setup.allowBotTakeover,
  });
  const bots = setup.botCount;
  for (let index = 0; index < bots; index += 1) {
    onlineSession.addBot(setup.difficulty);
  }
}

/* 面板里不再有「准备」按钮，进房即自动准备。
   房间消息里的 self 只有 seatId / reconnectToken，准备状态要从座位表读。 */
function ensureAutoReady() {
  if (isSpectating || !onlineSession || !onlineRoom) return;
  if (onlineRoom.status !== "LOBBY") return;
  const seat = selfSeat();
  if (!seat || seat.kind !== "HUMAN" || seat.ready) return;
  onlineSession.setReady(true);
}

function selfSeat() {
  if (!onlineRoom || !onlineSelf || onlineSelf.seatId === undefined) return null;
  return onlineRoom.seats.find((seat) => seat.seatId === onlineSelf.seatId) || null;
}

function requestMatchHistoryView() {
  if (!onlineSession) {
    historyStatusElement.textContent = "连接服务器后查看战绩";
    return;
  }
  setSidebarTab("log");
  historyStatusElement.textContent = "正在读取战绩…";
  onlineSession.requestMatchHistory();
}

function requestReplayView() {
  replayDialogElement.classList.remove("hidden");
  replayMetaElement.textContent = "正在读取复盘";
  replayEventDetailElement.textContent = "正在从服务器加载事件…";
  replayEventListElement.replaceChildren();
  replayRangeElement.max = "0";
  replayRangeElement.value = "0";
  replayPrevButton.disabled = true;
  replayNextButton.disabled = true;
  replayToggleButton.disabled = true;

  if (!onlineSession || !onlineRoom) {
    replayMetaElement.textContent = "无法读取复盘";
    replayEventDetailElement.textContent = "请先连接服务器并加入一个房间。";
    setSidebarTab("log");
    historyStatusElement.textContent = "加入房间后查看复盘";
    return;
  }
  setSidebarTab("log");
  historyStatusElement.textContent = "正在读取复盘…";
  onlineSession.requestReplay({ roomId: onlineRoom.id });
}

function renderMatchHistory() {
  matchHistorySummaryElement.replaceChildren();
  matchHistorySummaryElement.classList.toggle("hidden", matchHistory.length === 0);
  for (const match of matchHistory.slice(0, 8)) {
    const row = document.createElement("div");
    row.className = "match-history-row";
    const title = document.createElement("strong");
    const winner = match.players?.find((player) => player.id === match.winnerId);
    title.textContent = winner ? `胜者：${winner.name}` : "无胜者";
    const detail = document.createElement("span");
    detail.textContent =
      `房间 ${match.roomId} · ${match.players?.length || 0} 人 · ` +
      `${match.endedAt ? new Date(match.endedAt).toLocaleString() : "未知时间"}`;
    row.append(title, detail);
    matchHistorySummaryElement.append(row);
  }
  historyStatusElement.textContent =
    matchHistory.length === 0
      ? "暂无战绩，完成一局联机对局后会显示在这里。"
      : `已加载 ${matchHistory.length} 局战绩。`;
}

function openReplayDialog(replay) {
  historyStatusElement.textContent = `已加载复盘：${replay.events.length} 条事件。`;
  replayData = replay;
  replayIndex = 0;
  replayPrevButton.disabled = replay.events.length <= 1;
  replayNextButton.disabled = replay.events.length <= 1;
  replayToggleButton.disabled = replay.events.length <= 1;
  replayRangeElement.max = String(Math.max(0, replay.events.length - 1));
  replayRangeElement.value = "0";
  replayDialogElement.classList.remove("hidden");
  renderReplay();
}

function closeReplayDialog() {
  stopReplayPlayback();
  replayDialogElement.classList.add("hidden");
}

function setReplayIndex(index) {
  if (!replayData?.events?.length) return;
  replayIndex = Math.max(
    0,
    Math.min(Number(index), replayData.events.length - 1),
  );
  replayRangeElement.value = String(replayIndex);
  renderReplay();
}

function renderReplay() {
  if (!replayData?.events?.length) return;
  const event = replayData.events[replayIndex];
  const view = {
    players:
      replayData.players?.length > 0
        ? replayData.players
        : session?.state?.players || [],
  };
  replayMetaElement.textContent =
    `房间 ${replayData.roomId} · 第 ${replayIndex + 1} / ${replayData.events.length} 条`;
  replayEventDetailElement.textContent = formatEvent(event, view);
  replayEventListElement.replaceChildren();
  for (let index = 0; index < replayData.events.length; index += 1) {
    const item = document.createElement("li");
    item.textContent = `#${replayData.events[index].sequence} ${formatEvent(
      replayData.events[index],
      view,
    )}`;
    item.classList.toggle("active", index === replayIndex);
    replayEventListElement.append(item);
  }
  replayEventListElement.querySelector(".active")?.scrollIntoView({
    block: "nearest",
  });
}

function toggleReplayPlayback() {
  if (replayTimer) {
    stopReplayPlayback();
    return;
  }
  if (!replayData?.events?.length) return;
  if (replayIndex >= replayData.events.length - 1) setReplayIndex(0);
  replayToggleButton.textContent = "暂停";
  replayTimer = setInterval(() => {
    if (!replayData || replayIndex >= replayData.events.length - 1) {
      stopReplayPlayback();
      return;
    }
    setReplayIndex(replayIndex + 1);
  }, 900);
}

function stopReplayPlayback() {
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
  replayToggleButton.textContent = "播放";
}

function animateEvents(events) {
  if (!events.length) return;
  const types = new Set(events.map((event) => event.type));
  if (types.has("DICE_ROLLED")) {
    diceRollPulse = true;
    pulseClass(diceDisplayElement, "rolling", MOTION.beat);
    sound.play("dice");
  }
  if (types.has("DICE_ROLLED")) playHarvest(events);
  /* 阶段换了：顶栏的阶段标、回合牌上的那句，都像刚落笔一样压一下再稳下来 */
  if (types.has("PHASE_CHANGED")) {
    pulseClass(phaseElement, "phase-flip", MOTION.beat);
    if (turnPillElement) pulseClass(turnPillElement, "phase-flip", MOTION.beat);
  }
  /* 轮到谁：顶栏名字换过来，玩家面板里标记牌"搬"到新那一行；
     如果是我，回合牌再暖一下并给一声轻音 */
  if (types.has("TURN_STARTED")) {
    const started = events.find((event) => event.type === "TURN_STARTED");
    const playerId = started?.payload?.playerId;
    pulseClass(currentPlayerElement, "turn-flip", MOTION.carry);
    if (playerId !== undefined && playerId !== null) {
      const row = playersElement.querySelector(
        `.player-row[data-player-id="${playerId}"]`,
      );
      if (row) pulseClass(row, "player-row-turn", MOTION.hold);
      if (playerId === HUMAN_ID && turnPillElement) {
        pulseClass(turnPillElement, "my-turn", MOTION.lift);
        sound.play("turn");
      }
    }
  }
  if (types.has("RESOURCES_GAINED")) {
    /* 收货音谁都听得见；手牌整体的那一下只在真的收到自己手里时闪 */
    sound.play("gain");
    const gainedByMe = events.some(
      (event) =>
        event.type === "RESOURCES_GAINED" && event.payload?.playerId === HUMAN_ID,
    );
    if (gainedByMe) pulseClass(handDockElement, "receiving", MOTION.rise);
  }
  if (types.has("ROAD_PLACED")) {
    pulseClass(boardStageElement, "board-fx-road", MOTION.rise);
    sound.play("road");
  }
  if (types.has("SETTLEMENT_PLACED") || types.has("CITY_PLACED")) {
    pulseClass(boardStageElement, "board-fx-build", MOTION.rise);
    sound.play("build");
  }
  if (types.has("ROBBER_MOVED")) {
    pulseClass(boardStageElement, "board-fx-robber", MOTION.rise);
    sound.play("robber");
  }
  if (types.has("BANK_TRADE_COMPLETED")) {
    sound.play("coin");
  }
}

function pulseClass(element, className, duration) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
  setTimeout(() => element.classList.remove(className), duration);
}

function connectOnline(role = "player") {
  if (onlineSession) onlineSession.close();
  isSpectating = role === "spectator";
  /* 换房间了：座位表行数按新房间重新推断，创建流程随后会自己写上 */
  roomTableSize = null;
  setSidebarTab("room");

  const roomId = onlineRoomIdInput.value.trim() || "catan-room";
  const name = onlinePlayerNameInput.value.trim() || "玩家";
  const tokenKey = `catania-reconnect-${roomId}`;
  const url = resolveWebSocketUrl();

  onlineSession = new RemoteGameSession({
    url,
    roomId,
    name,
    reconnectToken:
      sessionStorage.getItem(tokenKey) || localStorage.getItem(tokenKey),
    guestId,
    role,
  });
  onlineSession.subscribe(handleOnlineMessage);
  setNetStatus("connecting");
  onlineStatusElement.textContent = isSpectating ? "观战连接中" : "连接中";
}

function resolveWebSocketUrl() {
  if (location.protocol === "http:" || location.protocol === "https:") {
    const websocketProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    return `${websocketProtocol}//${location.host}/ws`;
  }
  return "ws://127.0.0.1:4173/ws";
}

function handleOnlineMessage(message) {
  document.body.dataset.lastOnlineMessage = message.type;
  if (message.type === "connected") {
    const wasOffline =
      netStatusElement?.dataset.state === "offline" ||
      netStatusElement?.dataset.state === "reconnecting";
    onlineStatusElement.textContent = isSpectating ? "观战已连接" : "已连接";
    setNetStatus("online");
    if (wasOffline) showNetToast("已重新连接。", "ok", 2600);
    else hideNetToast();
    return;
  }
  if (message.type === "room_state") {
    onlineRoom = message.room;
    onlineSelf = message.self || onlineSelf;
    if (onlineSelf?.reconnectToken) {
      const tokenKey = `catania-reconnect-${onlineRoom.id}`;
      sessionStorage.setItem(tokenKey, onlineSelf.reconnectToken);
      if (!localStorage.getItem(tokenKey)) {
        localStorage.setItem(tokenKey, onlineSelf.reconnectToken);
      }
    }
    applyPendingRoomSetup();
    ensureAutoReady();
    renderOnlineLobby();
    return;
  }
  if (message.type === "snapshot") {
    isSpectating = message.view?.viewerType === "SPECTATOR";
    if (!isSpectating) HUMAN_ID = message.playerId;
    session = onlineSession;
    renderOnlineLobby();
    if (isSpectating) setSidebarTab("log");
    render();
    return;
  }
  if (message.type === "command_rejected") {
    setActionHint(`命令被拒绝：${message.error?.code || "UNKNOWN"}`, "error");
    return;
  }
  if (message.type === "match_history") {
    matchHistory = message.matches || [];
    renderMatchHistory();
    return;
  }
  if (message.type === "replay_data") {
    openReplayDialog(message.replay);
    return;
  }
  if (message.type === "disconnected") {
    onlineStatusElement.textContent = "已断开";
    if (message.intentional) {
      setNetStatus("local");
      hideNetToast();
      return;
    }
    setNetStatus("offline");
    showNetToast("网络已断开，正在自动重连…", "warn");
    return;
  }
  if (message.type === "reconnecting") {
    setNetStatus("reconnecting", `第 ${message.attempt} 次`);
    showNetToast(`网络已断开，正在重连（第 ${message.attempt} 次）…`, "warn");
    return;
  }
  if (message.type === "connection_error") {
    onlineStatusElement.textContent = "连接失败";
    setNetStatus("reconnecting");
    showNetToast("连接出错，正在重试…", "error");
    return;
  }
  if (message.type === "error") {
    document.body.dataset.lastOnlineError = `${message.code || "ERROR"}: ${message.message || ""}`;
    onlineStatusElement.textContent =
      message.code === "ROOM_IN_PROGRESS"
        ? "房间已开始，请新建房间号"
        : message.code === "ROOM_FULL"
          ? "房间已满"
          : message.message || "联机错误";
    if (message.code === "REPLAY_NOT_AVAILABLE") {
      onlineStatusElement.textContent = "对局结束后才能查看完整复盘";
      historyStatusElement.textContent = "对局结束后才能查看完整复盘。";
      replayMetaElement.textContent = "暂无复盘";
      replayEventDetailElement.textContent = "对局结束后才能查看完整复盘。";
    } else if (message.code === "REPLAY_NOT_FOUND") {
      historyStatusElement.textContent =
        "该对局没有归档事件；事件归档启用前完成的旧对局无法完整复盘。";
      replayMetaElement.textContent = "暂无复盘";
      replayEventDetailElement.textContent =
        "该对局没有归档事件。事件归档启用前完成的旧对局无法完整复盘；新开一局后会自动记录。";
    }
    return;
  }
  if (
    message.type === "player_kicked" ||
    message.type === "spectator_kicked"
  ) {
    onlineRoom = null;
    onlineSelf = null;
    isSpectating = false;
    session = null;
    roomTableSize = null;
    pendingRoomSetup = null;
    onlineStatusElement.textContent =
      message.type === "player_kicked" ? "你已被移出房间" : "你已被移出观战";
    renderOnlineLobby();
  }
}

function renderOnlineLobby() {
  /* 没进房间：只显示进房入口（房间号 / 名称 / 连接服务器 / 创建房间） */
  if (!onlineRoom) {
    onlineEntryElement.classList.remove("hidden");
    onlineRoomViewElement.classList.add("hidden");
    return;
  }
  onlineEntryElement.classList.add("hidden");
  onlineRoomViewElement.classList.remove("hidden");

  onlineStatusElement.textContent = isSpectating
    ? `观战中 · ${onlineRoom.spectatorCount || 0} 人`
    : onlineRoom.status === "LOBBY"
      ? "等待开始"
      : "游戏中";
  onlineSeatsElement.replaceChildren();
  for (const seat of onlineRoom.seats.slice(0, visibleSeatCount(onlineRoom))) {
    const row = document.createElement("div");
    row.className = "online-seat";
    const identity = document.createElement("span");
    identity.textContent = seat.kind
      ? `${seat.seatId + 1}. ${seat.name}`
      : `${seat.seatId + 1}. 空位`;
    const state = document.createElement("span");
    state.textContent =
      seat.kind === "BOT"
        ? `人机 · ${difficultyLabel(seat.difficulty)}`
        : seat.kind === "HUMAN"
          ? seat.controlledByBot
            ? "Bot 接管中"
            : seat.connected
              ? seat.ready
                ? "已准备"
                : "未准备"
              : "离线 · 等待重连"
          : "空闲";
    row.append(identity, state);
    onlineSeatsElement.append(row);
  }

  onlineSpectatorsElement.replaceChildren();
  const spectators = onlineRoom.spectators || [];
  if (spectators.length === 0) {
    const empty = document.createElement("span");
    empty.className = "spectator-chip empty";
    empty.textContent = "暂无观众";
    onlineSpectatorsElement.append(empty);
  } else {
    for (const spectator of spectators) {
      const chip = document.createElement("span");
      chip.className = "spectator-chip";
      chip.textContent = spectator.name;
      onlineSpectatorsElement.append(chip);
    }
  }

  const isHost = onlineRoom.hostClientId === onlineSession?.clientId;
  const isLobby = onlineRoom.status === "LOBBY";
  const activeSeats = onlineRoom.seats.filter((seat) => seat.kind);
  const humansReady = onlineRoom.seats
    .filter((seat) => seat.kind === "HUMAN")
    .every((seat) => seat.connected && seat.ready);

  /* 房间号放出来，房主好发给要一起玩的人；座位不够 3 个时点明还差几座 */
  onlineRoomIdValueElement.textContent = onlineRoom.id;
  const missingSeats = Math.max(0, 3 - activeSeats.length);
  onlineRoomHintElement.textContent = missingSeats > 0 ? `还差 ${missingSeats} 座才能开局` : "";
  onlineRoomHintElement.classList.toggle("hidden", missingSeats === 0);

  /* 3 或 4 个座位坐满、且人类都连上并准备后，房主才能开桌 */
  onlineStartButton.disabled =
    isSpectating ||
    !isHost ||
    !isLobby ||
    activeSeats.length < 3 ||
    !humansReady;

  const canManageRoom = isHost && !isSpectating;

  onlinePlayerControlsElement.replaceChildren();
  if (canManageRoom && onlineRoom.status === "PLAYING") {
    for (const seat of onlineRoom.seats) {
      if (
        seat.kind !== "HUMAN" ||
        seat.seatId === onlineSelf?.seatId
      ) {
        continue;
      }
      const row = document.createElement("div");
      row.className = "online-control-row";
      const label = document.createElement("span");
      label.textContent = `${seat.name} · ${seat.connected ? "在线" : "离线"}`;
      const kick = document.createElement("button");
      kick.type = "button";
      kick.textContent = "踢出";
      kick.addEventListener("click", () => onlineSession?.kickPlayer(seat.seatId));
      const hostButton = document.createElement("button");
      hostButton.type = "button";
      hostButton.textContent = "设为房主";
      hostButton.disabled = !seat.connected;
      hostButton.addEventListener("click", () =>
        onlineSession?.transferHost(seat.seatId),
      );
      row.append(label, kick, hostButton);
      onlinePlayerControlsElement.append(row);
    }
  }

  onlineSpectatorControlsElement.replaceChildren();
  if (canManageRoom) {
    for (const spectator of onlineRoom.spectators || []) {
      const row = document.createElement("div");
      row.className = "online-control-row";
      const label = document.createElement("span");
      label.textContent = `观众：${spectator.name}`;
      const kick = document.createElement("button");
      kick.type = "button";
      kick.textContent = "移出观战";
      kick.addEventListener("click", () =>
        onlineSession?.kickSpectator(spectator.spectatorId),
      );
      row.append(label, kick);
      onlineSpectatorControlsElement.append(row);
    }
  }
}

function difficultyLabel(difficulty) {
  if (difficulty === "easy") return "简单";
  if (difficulty === "hard") return "困难";
  return "中等";
}

function getOrCreateGuestId() {
  const key = "catania-guest-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id =
    globalThis.crypto?.randomUUID?.() ||
    `guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(key, id);
  return id;
}

function scheduleBotTurn() {
  if (session?.isRemote) return;
  if (!session) return;
  if (botTimer) clearTimeout(botTimer);

  const playerId = getBotActorId();
  const player = session.state.players[playerId];
  const setupPhase =
    session.phase === GAME_PHASES.SETUP_ROUND_1 ||
    session.phase === GAME_PHASES.SETUP_ROUND_2;
  const turnPhase =
    session.phase === GAME_PHASES.AWAITING_ROLL ||
    session.phase === GAME_PHASES.TURN_ACTIONS ||
    session.phase === GAME_PHASES.AWAITING_DISCARD ||
    session.phase === GAME_PHASES.AWAITING_ROBBER_MOVE ||
    session.phase === GAME_PHASES.AWAITING_STEAL_TARGET ||
    session.phase === GAME_PHASES.AWAITING_FREE_ROAD ||
    session.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE;

  if ((!setupPhase && !turnPhase) || !player?.isBot) return;

  botTimer = setTimeout(() => {
    const view = session.getView(playerId);
    const command = chooseBotCommand(
      view,
      player.difficulty || "medium",
      Math.random,
    );
    if (command) session.dispatch(playerId, command);
    render();
    scheduleBotTurn();
  }, 520);
}

function getBotActorId() {
  if (session.state.trade) {
    const responder = session.state.trade.currentResponderPlayerId;
    if (responder !== null) {
      return session.state.players[responder]?.isBot ? responder : undefined;
    }
    const creator = session.state.players[session.state.trade.fromPlayerId];
    if (creator?.isBot) return creator.id;
    return undefined;
  }

  if (session.phase !== GAME_PHASES.AWAITING_DISCARD) {
    return session.state.currentPlayerId;
  }

  return Object.keys(session.state.pendingAction?.requiredByPlayer || {})
    .map(Number)
    .find((playerId) => session.state.players[playerId]?.isBot);
}

function render() {
  if (!session) return;

  const state = session.state;
  const view = session.getView(HUMAN_ID);
  /* 弹窗里的控件（步进器上限、发起按钮）不在 render 的调用链上，
     要自己回来取当前视图，所以留一份 */
  lastView = view;
  const currentPlayer = state.players[state.currentPlayerId];
  const newEvents = view.eventLog.filter(
    (event) => event.sequence > lastRenderedSequence,
  );
  if (view.eventLog.length > 0) {
    lastRenderedSequence = Math.max(
      lastRenderedSequence,
      ...view.eventLog.map((event) => event.sequence),
    );
  }

  phaseElement.textContent = PHASE_LABELS[state.phase] || state.phase;
  currentPlayerElement.textContent = currentPlayer
    ? `${currentPlayer.name}${currentPlayer.isBot ? " (AI)" : ""}`
    : "-";
  setActionHint(getActionHint(view));
  playerCountElement.textContent = `${state.players.length} 人`;

  const nextBoardRenderKey = [
    view.version,
    view.phase,
    view.currentPlayerId,
    selectedBuild || "",
    view.robberHexId ?? "",
    view.validCommands.length,
  ].join(":");
  if (nextBoardRenderKey !== boardRenderKey) {
    renderBoard(view);
    boardRenderKey = nextBoardRenderKey;
  }
  applyBoardView();
  renderTurnControls(view);
  renderTurnTimer();
  renderSpecialControls(view);
  const previousHand = snapshotHandCounts();
  renderHandDock(view);
  playHandDelta(previousHand, view, newEvents);
  renderPlayers(view);
  syncTradeSlip(view, newEvents);
  playOpponentGains(view, newEvents);
  renderEventLog(view);
  renderCompletion(view);
  animateEvents(newEvents);
  if (!session.isRemote && !botTimer) {
    const actorId = getBotActorId();
    if (actorId !== undefined && actorId !== null && state.players[actorId]?.isBot) {
      scheduleBotTurn();
    }
  }
}

function renderTurnTimer() {
  if (onlineRoom?.paused) {
    turnTimerElement.textContent = "对局已暂停";
    turnTimerElement.classList.remove("warning");
    turnTimerElement.classList.add("danger");
    return;
  }
  const timer = session?.state?.timer;
  if (!timer || timer.deadline <= 0) {
    turnTimerElement.textContent = "无倒计时";
    turnTimerElement.classList.remove("warning", "danger");
    return;
  }

  const remainingMs = Math.max(0, timer.deadline - Date.now());
  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const actor = session.state.players?.[timer.actorPlayerId];
  turnTimerElement.textContent = `剩余 ${remainingSeconds} 秒${
    actor ? ` · ${actor.name}` : ""
  }`;
  turnTimerElement.classList.toggle(
    "warning",
    remainingSeconds <= 20 && remainingSeconds > 10,
  );
  turnTimerElement.classList.toggle("danger", remainingSeconds <= 10);
}

function getActionHint(view) {
  if (isSpectating) return "观战模式：只显示公开棋盘和公开事件";
  const discardCommand = view.validCommands.find(
    (command) => command.type === "DISCARD_RESOURCES",
  );
  if (discardCommand) {
    return `手牌超过 7 张，请选择 ${discardCommand.required} 张资源弃掉`;
  }
  if (view.trade) {
    const responder = view.trade.currentResponderPlayerId;
    if (responder !== null) {
      return responder === HUMAN_ID
        ? "轮到你回应这笔交易"
        : `等待 ${view.players[responder]?.name || "玩家"} 回应交易`;
    }
    if (view.trade.fromPlayerId === HUMAN_ID) {
      return "所有玩家已回应，可以成交或取消交易";
    }
    return "等待交易发起者处理结果";
  }
  const tradeAction = view.validCommands.find((command) =>
    ["RESPOND_TO_TRADE", "CONFIRM_TRADE", "CANCEL_TRADE"].includes(command.type),
  );
  if (tradeAction) {
    if (tradeAction.type === "RESPOND_TO_TRADE") {
      return tradeAction.accepted ? "可以接受这笔交易" : "可以拒绝这笔交易";
    }
    if (tradeAction.type === "CONFIRM_TRADE") return "选择一名已接受交易的玩家成交";
    return "可以取消这笔交易";
  }
  if (view.phase === GAME_PHASES.GAME_OVER) {
    const winner = view.players[view.winnerId];
    return winner ? `${winner.name} 已达到 10 分，游戏结束` : "游戏结束";
  }
  if (view.currentPlayerId !== HUMAN_ID) {
    if (view.phase === GAME_PHASES.AWAITING_ROLL) return "等待 AI 掷骰";
    if (view.phase === GAME_PHASES.TURN_ACTIONS) return "等待 AI 建造或结束回合";
    if (view.phase === GAME_PHASES.AWAITING_ROBBER_MOVE) return "等待 AI 移动强盗";
    if (view.phase === GAME_PHASES.AWAITING_STEAL_TARGET) return "等待 AI 选择偷取对象";
    if (view.phase === GAME_PHASES.AWAITING_FREE_ROAD) return "等待 AI 放置免费道路";
    if (view.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE) return "等待 AI 选择资源";
    return "等待 AI 放置";
  }
  if (view.phase === GAME_PHASES.AWAITING_ROLL) {
    return view.validCommands.some((command) => command.type.startsWith("PLAY_"))
      ? "掷骰，或先使用一张发展卡"
      : "点击掷骰开始回合";
  }
  if (view.phase === GAME_PHASES.TURN_ACTIONS) {
    return selectedBuild
      ? `点击高亮位置建造${buildLabel(selectedBuild)}`
      : "选择建造项目，或结束回合";
  }
  if (view.phase === GAME_PHASES.AWAITING_ROBBER_MOVE) {
    return "点击高亮地块移动强盗";
  }
  if (view.phase === GAME_PHASES.AWAITING_STEAL_TARGET) {
    return "选择一名玩家偷取资源";
  }
  if (view.phase === GAME_PHASES.AWAITING_FREE_ROAD) {
    return "点击高亮道路放置免费道路";
  }
  if (view.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
    return "选择一项银行资源";
  }
  if (view.setup.step === SETUP_STEPS.SETTLEMENT) {
    return "点击高亮交点放置定居点";
  }
  return "点击高亮边放置相邻道路";
}

function renderTurnControls(view) {
  const commandTypes = new Set(view.validCommands.map((command) => command.type));
  const isHumanTurn = view.currentPlayerId === HUMAN_ID;

  if (isSpectating) {
    rollDiceButton.disabled = true;
    endTurnButton.disabled = true;
    buildRoadButton.disabled = true;
    buildSettlementButton.disabled = true;
    buildCityButton.disabled = true;
    buildHintElement.textContent = "观战模式不可操作";
    return;
  }

  rollDiceButton.disabled = !isHumanTurn || !commandTypes.has("ROLL_DICE");
  endTurnButton.disabled = !isHumanTurn || !commandTypes.has("END_TURN");
  buildRoadButton.disabled =
    !isHumanTurn || !commandTypes.has("BUILD_ROAD");
  buildSettlementButton.disabled =
    !isHumanTurn || !commandTypes.has("BUILD_SETTLEMENT");
  buildCityButton.disabled =
    !isHumanTurn || !commandTypes.has("BUILD_CITY");

  if (selectedBuild && !commandTypes.has(buildCommandType(selectedBuild))) {
    selectedBuild = null;
  }

  buildRoadButton.classList.toggle("selected", selectedBuild === "road");
  buildSettlementButton.classList.toggle("selected", selectedBuild === "settlement");
  buildCityButton.classList.toggle("selected", selectedBuild === "city");

  if (
    view.phase === GAME_PHASES.SETUP_ROUND_1 ||
    view.phase === GAME_PHASES.SETUP_ROUND_2
  ) {
    turnStatusElement.textContent = "初始放置";
    renderDice(null);
    buildHintElement.textContent = "初始放置完成后可建造";
    return;
  }

  if (view.phase === GAME_PHASES.AWAITING_FREE_ROAD) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 免费道路`;
    renderDice(view.turn.dice);
    buildHintElement.textContent = `剩余 ${view.pendingAction?.roadsRemaining || 0} 条免费道路`;
    return;
  }

  if (view.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 选择资源`;
    renderDice(view.turn.dice);
    buildHintElement.textContent = `剩余 ${view.pendingAction?.choicesRemaining || 0} 次选择`;
    return;
  }

  if (view.phase === GAME_PHASES.AWAITING_DISCARD) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 等待弃牌`;
    renderDice(view.turn.dice);
    buildHintElement.textContent = "弃牌完成后才能移动强盗";
    return;
  }

  if (view.phase === GAME_PHASES.AWAITING_ROBBER_MOVE) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 移动强盗`;
    renderDice(view.turn.dice);
    buildHintElement.textContent = "选择非当前所在地块";
    return;
  }

  if (view.phase === GAME_PHASES.AWAITING_STEAL_TARGET) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 选择偷取对象`;
    renderDice(view.turn.dice);
    buildHintElement.textContent = "从相邻且有资源的玩家中选择";
    return;
  }

  if (view.phase === GAME_PHASES.GAME_OVER) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 已结束`;
    buildHintElement.textContent = "游戏已结束";
    return;
  }

  if (view.turn.hasRolled) {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 已掷骰`;
  } else {
    turnStatusElement.textContent = `第 ${view.turnNumber} 轮 · 等待掷骰`;
  }

  renderDice(view.turn.dice);

  if (view.phase === GAME_PHASES.AWAITING_ROLL && isHumanTurn) {
    buildHintElement.textContent = "可掷骰，或先使用一张发展卡";
  } else if (view.phase !== GAME_PHASES.TURN_ACTIONS || !isHumanTurn) {
    buildHintElement.textContent = "等待当前玩家行动";
  } else if (selectedBuild) {
    buildHintElement.textContent = `${buildLabel(selectedBuild)}：${formatCost(
      BUILD_COSTS[selectedBuild],
    )}`;
  } else {
    buildHintElement.textContent = "选择建造项目或结束回合";
  }
}

function renderSpecialControls(view) {
  if (isSpectating) {
    discardControlsElement.classList.add("hidden");
    stealControlsElement.classList.add("hidden");
    developmentControlsElement.classList.add("hidden");
    resourceChoiceControlsElement.classList.add("hidden");
    tradeControlsElement.classList.add("hidden");
    actionPlaceholderElement.textContent =
      "观战模式：只接收公开棋盘、公开资源和公开事件。";
    actionPlaceholderElement.classList.remove("hidden");
    return;
  }

  actionPlaceholderElement.textContent = "当前没有需要处理的行动";
  const discardCommand = view.validCommands.find(
    (command) => command.type === "DISCARD_RESOURCES",
  );
  const stealCommands = view.validCommands.filter(
    (command) => command.type === "CHOOSE_STEAL_TARGET",
  );

  if (discardCommand) {
    const required = discardCommand.required;
    if (!discardSelection || discardSelection.required !== required) {
      discardSelection = {
        required,
        resources: Object.fromEntries(RESOURCES.map((resource) => [resource, 0])),
      };
    }

    discardControlsElement.classList.remove("hidden");
    renderDiscardChoices(view, discardCommand.required);
  } else {
    discardControlsElement.classList.add("hidden");
    discardSelection = null;
  }

  stealControlsElement.classList.toggle("hidden", stealCommands.length === 0);
  if (stealCommands.length > 0) {
    stealPlayerListElement.replaceChildren();
    for (const command of stealCommands) {
      const player = view.players[command.playerId];
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${player.name} · 手牌 ${player.resourceCount}`;
      button.addEventListener("click", () => dispatchHuman(command));
      stealPlayerListElement.append(button);
    }
  }

  const showDevelopmentControls =
    view.phase === GAME_PHASES.AWAITING_ROLL ||
    view.phase === GAME_PHASES.TURN_ACTIONS;
  developmentControlsElement.classList.toggle(
    "hidden",
    !showDevelopmentControls,
  );
  if (showDevelopmentControls) {
    const buyCommand = view.validCommands.find(
      (command) => command.type === "BUY_DEVELOPMENT_CARD",
    );
    const playableCardCommands = view.validCommands.filter(
      (command) =>
        command.type === "REVEAL_VICTORY_POINT" ||
        command.type.startsWith("PLAY_"),
    );
    buyDevelopmentCardButton.disabled = !buyCommand;
    developmentSummaryElement.textContent =
      `手牌 ${view.players[HUMAN_ID].developmentCardCount} · ` +
      `牌堆 ${view.developmentDeckCount} · ${developmentStatus(view, buyCommand)}`;
    renderDevelopmentCardList(view, playableCardCommands);
  }

  const resourceCommands = view.validCommands.filter(
    (command) => command.type === "CHOOSE_RESOURCE",
  );
  resourceChoiceControlsElement.classList.toggle(
    "hidden",
    resourceCommands.length === 0,
  );
  if (resourceCommands.length > 0) {
    resourceChoiceListElement.replaceChildren();
    for (const command of resourceCommands) {
      const button = document.createElement("button");
      button.type = "button";
      appendResourceLabel(button, command.resource, RESOURCE_LABELS[command.resource]);
      button.addEventListener("click", () => dispatchHuman(command));
      resourceChoiceListElement.append(button);
    }
  }

  renderTradeControls(view);
  actionPlaceholderElement.classList.toggle(
    "hidden",
    [
      discardControlsElement,
      stealControlsElement,
      developmentControlsElement,
      resourceChoiceControlsElement,
      tradeControlsElement,
    ].some((element) => !element.classList.contains("hidden")),
  );
}

/* ---------- 手牌增减：数字滚动 + 飞牌 ----------
   手牌格每次 render 都会重建，所以「上一次显示的数字」要在重建前读下来。
   飞牌的起点优先取产出它的那块地（RESOURCES_PRODUCED 带 hexId），
   没有来源（交易、偷牌）就从桌面中央飞；失去资源时反向飞回桌面。
   动画只落在临时的 #hand-fx-layer 浮层上，不碰手牌自身结构。 */

let handFxLayer = null;
/* 手牌格的 DOM 只建一次，之后只改数字 —— 否则每次 render 重建会把
   正在滚的数字和落点脉冲一起换掉，动画看起来就是"闪一下就没了"。 */
const handTileByResource = new Map();

function handFxRoot() {
  if (!handFxLayer) {
    handFxLayer = document.createElement("div");
    handFxLayer.id = "hand-fx-layer";
    handFxLayer.setAttribute("aria-hidden", "true");
    document.body.append(handFxLayer);
  }
  return handFxLayer;
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function snapshotHandCounts() {
  const counts = new Map();
  for (const tile of handDockElement.querySelectorAll(".hand-tile")) {
    const resource = String(tile.dataset.card || "").split(":")[1];
    const value = Number(tile.querySelector("strong")?.textContent);
    if (resource && Number.isFinite(value)) counts.set(resource, value);
  }
  return counts;
}

/* format 用来带前缀：手牌格滚的是纯数字，玩家行滚的是「手牌 N」 */
function rollHandNumber(element, from, to, format = (value) => String(value)) {
  if (from === to) return;
  /* 标记挂在被动画的那个元素上：重画时靠它决定"这格先别动" */
  element.dataset.rolling = "1";
  const finish = () => {
    element.textContent = format(to);
    delete element.dataset.rolling;
  };
  if (prefersReducedMotion()) {
    finish();
    return;
  }
  const duration = MOTION.base;
  const startedAt = performance.now();
  const step = (now) => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - (1 - progress) ** 3;
    element.textContent = format(Math.round(from + (to - from) * eased));
    if (progress < 1) requestAnimationFrame(step);
    else finish();
  };
  requestAnimationFrame(step);
}

function elementCenter(element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function hexScreenCenter(hexId) {
  const shape = boardElement.querySelector(`.hex-terrain[data-hex="${hexId}"]`);
  return shape ? elementCenter(shape) : null;
}

function tableCenter() {
  const canvas = document.querySelector(".board-canvas") || boardElement;
  return elementCenter(canvas);
}

/* 银行/港口兑换的"对面"在哪：兑换表就在侧栏那张纸上，货是跟它过的。
   侧栏收起或者不是我的回合，表量出来是 0，退回桌面中央。 */
function bankTradeAnchor() {
  const form = document.querySelector("#bank-trade-form");
  if (form && form.getBoundingClientRect().width > 0) return elementCenter(form);
  return tableCenter();
}

function flyHandCard({ resource, start, target, delay, incoming }) {
  if (prefersReducedMotion()) return;
  const card = document.createElement("div");
  card.className = `hand-fx-card${incoming ? "" : " is-outgoing"}`;
  card.textContent = RESOURCE_LABELS[resource] || "";
  card.style.left = `${Math.round(start.x)}px`;
  card.style.top = `${Math.round(start.y)}px`;
  handFxRoot().append(card);

  const dx = Math.round(target.x - start.x);
  const dy = Math.round(target.y - start.y);
  /* 沿路径的法线抬一点，飞出一道浅弧 —— 直线平移看着像"滑"，不像"扔" */
  const length = Math.hypot(dx, dy) || 1;
  const lift = Math.min(84, length * 0.2);
  const midX = Math.round(dx / 2 - (dy / length) * lift);
  const midY = Math.round(dy / 2 + (dx / length) * lift);
  const tilt = incoming ? -7 : 7;
  const centre = "translate(-50%, -50%)";

  card.animate(
    [
      { transform: `${centre} translate(0px, 0px) scale(1) rotate(0deg)`, opacity: 1 },
      {
        transform: `${centre} translate(${midX}px, ${midY}px) scale(0.94) rotate(${tilt}deg)`,
        opacity: 1,
        offset: 0.62,
      },
      {
        transform: `${centre} translate(${dx}px, ${dy}px) scale(0.72) rotate(0deg)`,
        opacity: 0.12,
      },
    ],
    {
      duration: MOTION.fly,
      delay,
      easing: MOTION.ease.soft,
      fill: "forwards",
    },
  );
  window.setTimeout(() => card.remove(), MOTION.fly + 200 + delay);
}

/* 收成：先整片点亮这一掷落到的地块，再按产出顺序一块一块亮起来。
   数据来自 DICE_ROLLED（点数）和 RESOURCES_PRODUCED（哪几块地真的产出了、按顺序）。
   一次掷骰没人收成时也得有反馈，否则看着像卡住：只把点数对应的地块点一下。 */
function playHarvest(events) {
  if (prefersReducedMotion()) return;
  const rolled = events.find((event) => event.type === "DICE_ROLLED");
  const produced = events.filter((event) => event.type === "RESOURCES_PRODUCED");
  const total = rolled
    ? Number(rolled.payload?.die1) + Number(rolled.payload?.die2)
    : null;
  if (!Number.isFinite(total)) return;

  const numberTiles = () =>
    boardElement.querySelectorAll(`.hex-harvest[data-number="${total}"]`);

  if (produced.length === 0) {
    /* 掷出 7 时棋盘上根本没有 7，什么都不亮，安静留白即可 */
    if (total !== 7) {
      for (const tile of numberTiles()) pulseClass(tile, "harvest-flash", MOTION.carry);
    }
    return;
  }

  /* 整片提示：这个点数碰到了哪几块地 */
  for (const tile of numberTiles()) pulseClass(tile, "harvest-flash", MOTION.beat);

  /* 逐块点亮：和飞牌一样跟产出顺序走，稍微错开一点才看得出是一件件发生的 */
  produced.forEach((event, index) => {
    const tile = boardElement.querySelector(
      `.hex-harvest[data-hex="${event.payload?.hexId}"]`,
    );
    if (!tile) return;
    window.setTimeout(() => {
      pulseClass(tile, "harvest-pick", MOTION.carry);
      sound.play("ping");
    }, 280 + index * 150);
  });
}

/* 对手收资源：牌从产出地飞到「玩家」面板里他那一行，行落一下，「手牌 N」滚上去。
   玩家页签没打开时整行尺寸为 0，直接跳过（音效照旧）。 */
function playOpponentGains(view, events) {
  if (isSpectating) return;
  const gainedByPlayer = new Map();
  for (const event of events) {
    if (event.type !== "RESOURCES_GAINED") continue;
    const playerId = event.payload?.playerId;
    if (playerId === undefined || playerId === null || playerId === HUMAN_ID) continue;
    for (const [resource, amount] of Object.entries(event.payload.resources || {})) {
      if (!(amount > 0)) continue;
      const entry = gainedByPlayer.get(playerId) || { resources: [], total: 0 };
      entry.resources.push({ resource, amount });
      entry.total += amount;
      gainedByPlayer.set(playerId, entry);
    }
  }
  if (!gainedByPlayer.size) return;

  const origins = new Map();
  for (const event of events) {
    if (event.type !== "RESOURCES_PRODUCED") continue;
    const { hexId, resource, gains } = event.payload || {};
    const point = hexScreenCenter(hexId);
    if (!point) continue;
    for (const gain of gains || []) {
      if (gain.playerId === HUMAN_ID) continue;
      const key = `${gain.playerId}:${resource}`;
      const list = origins.get(key) || [];
      list.push(point);
      origins.set(key, list);
    }
  }

  const fallback = tableCenter();
  for (const [playerId, entry] of gainedByPlayer) {
    const row = playersElement.querySelector(
      `.player-row[data-player-id="${playerId}"]`,
    );
    if (!row) continue;
    const rowRect = row.getBoundingClientRect();
    if (!rowRect.width || !rowRect.height) continue;
    const target = elementCenter(row.querySelector(".resource-row .resource-chip") || row);
    let delay = 0;
    for (const { resource, amount } of entry.resources) {
      const starts = origins.get(`${playerId}:${resource}`) || [];
      for (let index = 0; index < Math.min(amount, 4); index += 1) {
        flyHandCard({
          resource,
          start: starts[index] || fallback,
          target,
          delay,
          incoming: true,
        });
        delay += 130;
      }
    }
    pulseClass(row, "player-row-gain", MOTION.beat);

    const text = row.querySelector(".resource-row .chip-text");
    const player = view.players?.[playerId];
    if (text && player && text.dataset.rolling !== "1") {
      rollHandNumber(
        text,
        Math.max(0, player.resourceCount - entry.total),
        player.resourceCount,
        (value) => `手牌 ${value}`,
      );
    }
  }
}

function playHandDelta(previous, view, events) {
  if (isSpectating) return;
  const mine = view?.players?.[HUMAN_ID]?.resources;
  if (!mine) return;

  /* 每块产出的地都留一个起点，按产出顺序排队飞进来 */
  const origins = new Map();
  for (const event of events) {
    if (event.type !== "RESOURCES_PRODUCED") continue;
    const { hexId, resource, gains } = event.payload || {};
    if (!(gains || []).some((gain) => gain.playerId === HUMAN_ID)) continue;
    const point = hexScreenCenter(hexId);
    if (!point) continue;
    const list = origins.get(resource) || [];
    list.push(point);
    origins.set(resource, list);
  }

  /* 成交收到的那一份：起点换成对手那边，别一律从桌面中央冒出来 */
  for (const event of events) {
    if (event.type !== "TRADE_COMPLETED") continue;
    const payload = event.payload || {};
    const participants = Array.isArray(payload.participants) ? payload.participants : [];
    if (participants.length !== 2 || !participants.includes(HUMAN_ID)) continue;
    const iAmInitiator = participants[0] === HUMAN_ID;
    const counterpart = iAmInitiator ? participants[1] : participants[0];
    const received = iAmInitiator ? payload.exchange?.request : payload.exchange?.offer;
    const point = playerAnchor(counterpart, view);
    for (const [resource, amount] of Object.entries(received || {})) {
      if (!(amount > 0)) continue;
      const list = origins.get(resource) || [];
      for (let index = 0; index < Math.min(amount, 4); index += 1) list.push(point);
      origins.set(resource, list);
    }
  }

  /* 银行兑换：给出去的飞向兑换表，换回来的也从那边飞回来 */
  let bankPoint = null;
  for (const event of events) {
    if (event.type !== "BANK_TRADE_COMPLETED") continue;
    if (event.payload?.playerId !== HUMAN_ID) continue;
    bankPoint = bankTradeAnchor();
    for (const [resource, amount] of Object.entries(event.payload.receive || {})) {
      if (!(amount > 0)) continue;
      const list = origins.get(resource) || [];
      for (let index = 0; index < Math.min(amount, 4); index += 1) list.push(bankPoint);
      origins.set(resource, list);
    }
    break;
  }

  for (const [resource, tile] of handTileByResource) {
    const now = mine[resource] ?? 0;
    const before = previous.has(resource) ? previous.get(resource) : now;
    if (before === now) continue;

    const strong = tile.querySelector("strong");
    if (strong) rollHandNumber(strong, before, now);

    const incoming = now > before;
    const target = elementCenter(tile);
    const starts = incoming ? origins.get(resource) || [] : [];
    const fallback = bankPoint || tableCenter();
    const count = Math.min(Math.abs(now - before), 4);
    for (let index = 0; index < count; index += 1) {
      flyHandCard({
        resource,
        start: incoming ? starts[index] || fallback : target,
        target: incoming ? target : fallback,
        /* 多张时拉开一点，慢飞之后才分得清是一张张来的 */
        delay: index * 130,
        incoming,
      });
    }
    pulseClass(tile, incoming ? "hand-gain" : "hand-spend", MOTION.rise);
  }
}

function renderHandDock(view) {
  /* 手牌重画说明局面变了，大卡跟着收起，避免看到过期的信息 */
  hideCardDetail(true);
  if (isSpectating) {
    handTileByResource.clear();
    handDockElement.replaceChildren();
    const spectatorTile = document.createElement("div");
    spectatorTile.className = "hand-tile spectator-tile";
    spectatorTile.textContent = "观战模式";
    handDockElement.append(spectatorTile);
    return;
  }

  const player = view.players[HUMAN_ID];
  if (!player?.resources) {
    handTileByResource.clear();
    handDockElement.replaceChildren();
    return;
  }

  /* 结构只建一次：牌面（风景 + 名称）是固定的，只有数字会变 */
  if (handTileByResource.size === 0) {
    handDockElement.replaceChildren();
    for (const resource of RESOURCES) {
      const tile = document.createElement("div");
      tile.className = "hand-tile";
      tile.dataset.card = `resource:${resource}`;
      tile.tabIndex = 0;
      attachCardDetail(tile);

      /* 手牌上半格放这张牌来自的那片地：60px 宽只容得下三四个形状的缩略风景 */
      const scene = document.createElementNS(SVG_NAMESPACE, "svg");
      scene.setAttribute("viewBox", "0 0 112 76");
      scene.setAttribute("class", "hand-scene");
      scene.setAttribute("role", "img");
      scene.setAttribute("aria-label", `${RESOURCE_LABELS[resource]}产地`);
      const sceneUse = document.createElementNS(SVG_NAMESPACE, "use");
      sceneUse.setAttribute("href", `#sc-${resource}`);
      scene.append(sceneUse);
      const amount = document.createElement("strong");
      const label = document.createElement("small");
      label.textContent = RESOURCE_LABELS[resource];
      tile.append(scene, amount, label);
      handTileByResource.set(resource, tile);
      handDockElement.append(tile);
    }
  }

  for (const [resource, tile] of handTileByResource) {
    /* 数字正在滚的那一格别去动它，否则动画会被这一行按死 */
    const strong = tile.querySelector("strong");
    if (strong?.dataset.rolling === "1") continue;
    const value = String(player.resources[resource]);
    if (strong && strong.textContent !== value) strong.textContent = value;
  }
}

function renderDevelopmentCardList(view, playableCardCommands) {
  const player = view.players[HUMAN_ID];
  const cards = player.developmentCards || [];
  devHandDockElement.replaceChildren();
  devHandHintElement.replaceChildren();
  if (!cards.length) {
    devHandHintElement.textContent = "发展卡 · 暂无";
    return;
  }

  let pickRowDrawn = false;
  for (const card of cards) {
    const commands = playableCardCommands.filter(
      (command) => command.cardId === card.id,
    );
    const name = DEVELOPMENT_CARD_LABELS[card.type] || "发展卡";

    const cardElement = document.createElement("div");
    cardElement.className = "hand-tile dev-card";
    cardElement.dataset.card = `dev:${card.type}`;
    cardElement.tabIndex = 0;
    attachCardDetail(cardElement);

    const art = document.createElementNS(SVG_NAMESPACE, "svg");
    art.setAttribute("viewBox", "0 0 96 60");
    art.setAttribute("class", "dev-card-art");
    art.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(SVG_NAMESPACE, "use");
    use.setAttribute("href", `#kc-${card.type}`);
    art.append(use);

    const label = document.createElement("small");
    label.textContent = name;
    cardElement.append(art, label);

    /* 状态不铺成文字行：可用的描铜绿边，刚买的整张退后，说明挂在 title 上 */
    const status = developmentCardStatus(view, card, commands);
    cardElement.title = `${name}：${status}`;
    if (commands.length === 1) {
      cardElement.classList.add("playable");
      cardElement.addEventListener("click", () => dispatchHuman(commands[0]));
    } else if (commands.length > 1) {
      cardElement.classList.add("choosing");
    } else if (player.newDevelopmentCardIds?.includes(card.id)) {
      cardElement.classList.add("fresh");
    }
    devHandDockElement.append(cardElement);

    /* 只有一个命令就直接点牌；有多个（垄断）在这一行给资源选择 */
    if (commands.length > 1 && !pickRowDrawn) {
      pickRowDrawn = true;
      const caption = document.createElement("span");
      caption.className = "dev-hint-caption";
      caption.textContent = `${name}：`;
      devHandHintElement.append(caption);
      for (const command of commands) {
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "dev-pick";
        pick.title = `${name}${RESOURCE_LABELS[command.resource]}`;
        pick.textContent = RESOURCE_MARKS[command.resource];
        pick.addEventListener("click", () => dispatchHuman(command));
        devHandHintElement.append(pick);
      }
    }
  }
  if (!pickRowDrawn) devHandHintElement.textContent = "发展卡";
}

function developmentCardStatus(view, card, commands) {
  const player = view.players[HUMAN_ID];
  if (player.newDevelopmentCardIds?.includes(card.id)) {
    return "本回合刚购买，下回合可用";
  }
  if (card.revealed) return "已公开";
  if (commands.length > 0) return "可使用";
  if (card.type === "victoryPoint") return "可公开";
  if (player.developmentCardPlayedThisTurn) return "本回合已使用过发展卡";
  return "暂不可用";
}

/* 发起交易搬进了独立弹窗：侧栏只留一个入口按钮。
   弹窗只负责"挑牌"，成交与否还是走引擎那套命令。 */
function openTradeDialog() {
  if (!tradeDialogElement) return;
  tradeDialogElement.classList.remove("hidden");
  updatePlayerTradeButton();
}

function closeTradeDialog() {
  if (!tradeDialogElement) return;
  tradeDialogElement.classList.add("hidden");
}

function renderTradeControls(view) {
  const showTradeControls = view.phase === GAME_PHASES.TURN_ACTIONS;
  tradeControlsElement.classList.toggle("hidden", !showTradeControls);
  if (!showTradeControls) {
    closeTradeDialog();
    return;
  }

  const tradeCommands = view.validCommands.filter((command) =>
    ["TRADE_WITH_BANK", "CREATE_TRADE", "RESPOND_TO_TRADE", "CONFIRM_TRADE", "CANCEL_TRADE"].includes(
      command.type,
    ),
  );

  if (view.trade) {
    /* 已经有交易在桌上了：不能再开一笔，把发起入口收起来 */
    closeTradeDialog();
    const responder = view.trade.currentResponderPlayerId;
    const responderText =
      responder === null
        ? "所有玩家已回应"
        : `等待 ${view.players[responder]?.name || "玩家"} 回应`;
    tradeSummaryElement.textContent =
      `${view.players[view.trade.fromPlayerId].name}：` +
      `${formatTradePool(view.trade.offer)} -> ${formatTradePool(view.trade.request)} · ${responderText}`;
    bankTradeFormElement.classList.add("hidden");
    openTradeDialogButton.classList.add("hidden");
    tradeActionListElement.replaceChildren();
    for (const command of tradeCommands) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tradeCommandLabel(command, view);
      button.addEventListener("click", () => dispatchHuman(command));
      tradeActionListElement.append(button);
    }
    return;
  }

  if (view.currentPlayerId !== HUMAN_ID) {
    tradeSummaryElement.textContent = "等待当前玩家发起交易";
    bankTradeFormElement.classList.add("hidden");
    openTradeDialogButton.classList.add("hidden");
    tradeActionListElement.replaceChildren();
    return;
  }

  bankTradeFormElement.classList.remove("hidden");
  openTradeDialogButton.classList.remove("hidden");
  tradeActionListElement.replaceChildren();
  tradeSummaryElement.textContent = "银行 / 港口贸易或向所有玩家发起交易";
  populateTradeSelects(view);
  renderTradeBuilder(view);

  const bankCommand = findSelectedBankTradeCommand(view);
  bankTradeButton.disabled = !bankCommand;
  bankTradeButton.textContent = bankCommand
    ? `银行 / 港口兑换 ${bankCommand.giveAmount}:${bankCommand.receiveAmount}`
    : "银行 / 港口兑换";
  updatePlayerTradeButton(view);
}

function populateTradeSelects(view) {
  const ownResources = view.players[HUMAN_ID].resources;
  populateResourceSelect(
    bankGiveResourceSelect,
    RESOURCES.filter((resource) => ownResources[resource] > 0),
  );
  populateResourceSelect(
    bankReceiveResourceSelect,
    RESOURCES.filter((resource) => resource !== bankGiveResourceSelect.value),
  );
}

function populateResourceSelect(select, resources) {
  const previous = select.value;
  select.replaceChildren();
  for (const resource of resources) {
    const option = document.createElement("option");
    option.value = resource;
    appendResourceLabel(option, resource, RESOURCE_LABELS[resource]);
    select.append(option);
  }
  if (resources.includes(previous)) select.value = previous;
}

function renderTradeBuilder(view) {
  const player = view.players[HUMAN_ID];
  tradeBuilderElement.replaceChildren();

  const sides = [
    {
      key: "offer",
      caption: "我给出",
      maximum: (resource) => player.resources?.[resource] || 0,
    },
    { key: "request", caption: "我想要", maximum: () => 10 },
  ];

  /* 每个资源一枚筹码：图记加步进器。两侧各一行，不再铺成五行双列 */
  for (const side of sides) {
    const row = document.createElement("div");
    row.className = "trade-builder-row";

    const caption = document.createElement("span");
    caption.className = "trade-builder-caption";
    caption.textContent = side.caption;
    row.append(caption);

    for (const resource of RESOURCES) {
      const chip = document.createElement("div");
      chip.className = "trade-chip";
      chip.title = `${side.caption}${RESOURCE_LABELS[resource]}`;
      /* 筹码太窄，放图标认不出来，直接用单字标记 */
      const mark = document.createElement("span");
      mark.className = "trade-chip-mark";
      mark.textContent = RESOURCE_MARKS[resource];
      chip.append(mark);
      chip.append(
        createTradeStepper({
          value: tradeDraft[side.key][resource],
          maximum: side.maximum(resource),
          title: `${side.caption}${RESOURCE_LABELS[resource]}`,
          onChange: (value) => {
            tradeDraft[side.key][resource] = value;
            renderTradeBuilder(view);
            updatePlayerTradeButton(view);
          },
        }),
      );
      row.append(chip);
    }
    tradeBuilderElement.append(row);
  }
}

function createTradeStepper({ value, maximum, title, onChange }) {
  const stepper = document.createElement("div");
  stepper.className = "trade-stepper";
  stepper.title = title;

  const current = clampTradeAmount(value, maximum);
  const decrease = document.createElement("button");
  decrease.type = "button";
  decrease.textContent = "-";
  decrease.disabled = current <= 0;
  decrease.addEventListener("click", () => onChange(current - 1));

  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "numeric";
  input.pattern = "[0-9]*";
  input.value = String(current);
  input.disabled = maximum <= 0;
  input.setAttribute("aria-label", title);
  input.addEventListener("change", () => {
    onChange(clampTradeAmount(input.value, maximum));
  });

  const increase = document.createElement("button");
  increase.type = "button";
  increase.textContent = "+";
  increase.disabled = current >= maximum;
  increase.addEventListener("click", () => onChange(current + 1));

  stepper.append(decrease, input, increase);
  return stepper;
}

function updatePlayerTradeButton(view = lastView) {
  if (!view) return;
  const command = findSelectedPlayerTradeCommand(view);
  createTradeButton.disabled = !command;
  createTradeButton.textContent = command
    ? `发起交易 ${formatTradePool(command.offer)} -> ${formatTradePool(command.request)}`
    : "向所有玩家发起交易";
}

function cleanTradeDraft(pool) {
  return Object.fromEntries(
    Object.entries(pool).filter(([, amount]) => Number(amount) > 0),
  );
}

function totalPool(pool) {
  return Object.values(pool).reduce(
    (total, amount) => total + Number(amount || 0),
    0,
  );
}

function clampTradeAmount(value, maximum) {
  return Math.min(maximum, Math.max(0, Math.floor(Number(value) || 0)));
}

function resetTradeDraft() {
  for (const resource of RESOURCES) {
    tradeDraft.offer[resource] = 0;
    tradeDraft.request[resource] = 0;
  }
}

function findSelectedBankTradeCommand(view) {
  return view.validCommands.find(
    (command) =>
      command.type === "TRADE_WITH_BANK" &&
      command.giveResource === bankGiveResourceSelect.value &&
      command.receiveResource === bankReceiveResourceSelect.value,
  );
}

function findSelectedPlayerTradeCommand(view) {
  const player = view.players[HUMAN_ID];
  const offer = cleanTradeDraft(tradeDraft.offer);
  const request = cleanTradeDraft(tradeDraft.request);
  if (totalPool(offer) <= 0 || totalPool(request) <= 0) return null;
  if (
    !RESOURCES.every(
      (resource) => player.resources[resource] >= Number(offer[resource] || 0),
    )
  ) {
    return null;
  }
  return {
    type: "CREATE_TRADE",
    offer,
    request,
    targetPlayerIds: view.players
      .filter((candidate) => candidate.id !== HUMAN_ID)
      .map((candidate) => candidate.id),
  };
}

function executeSelectedBankTrade() {
  const view = session.getView(HUMAN_ID);
  const command = findSelectedBankTradeCommand(view);
  if (command) dispatchHuman(command);
}

function executeSelectedPlayerTrade() {
  const view = session.getView(HUMAN_ID);
  const command = findSelectedPlayerTradeCommand(view);
  if (command) {
    dispatchHuman(command);
    resetTradeDraft();
  }
}

function tradeCommandLabel(command, view) {
  if (command.type === "RESPOND_TO_TRADE") {
    return command.accepted ? "接受交易" : "拒绝交易";
  }
  if (command.type === "CONFIRM_TRADE") {
    return `与 ${view.players[command.partnerId].name} 成交`;
  }
  if (command.type === "CANCEL_TRADE") return "取消交易";
  return command.type;
}

function formatTradePool(pool) {
  return Object.entries(pool)
    .filter(([, amount]) => amount > 0)
    .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
    .join("、");
}

/* ---------- 交易谈判小票 ----------
   一笔交易挂到桌上：从发起者那边飞出一张羊皮纸小票，写清「给什么、要什么」，
   每个对象各占一枚小牌；谁回了话，那枚牌就当场翻面盖戳。
   外观全部由 view.trade 推出来（不读事件），所以中途重连、后加入的人也照样对得上。
   小票只动 transform / opacity，落点用 left/top 定一次。 */

let tradeSlipLayer = null;
let tradeSlipObserver = null;
let tradeSlip = null;

function tradeSlipRoot() {
  if (!tradeSlipLayer) {
    tradeSlipLayer = document.createElement("div");
    tradeSlipLayer.id = "trade-slip-layer";
    tradeSlipLayer.setAttribute("aria-hidden", "true");
    document.body.append(tradeSlipLayer);
  }
  if (!tradeSlipObserver && typeof ResizeObserver === "function") {
    /* 收起侧栏、改窗口大小都会挪棋盘，小票得跟着重新落位 */
    tradeSlipObserver = new ResizeObserver(() => positionTradeSlip());
    tradeSlipObserver.observe(document.querySelector(".board-canvas") || boardElement);
  }
  return tradeSlipLayer;
}

function positionTradeSlip() {
  if (!tradeSlip) return;
  const canvas = document.querySelector(".board-canvas") || boardElement;
  const rect = canvas.getBoundingClientRect();
  /* 落在棋盘右上角那片空海上：右对齐，往下让开工具栏那一行 */
  const left = Math.round(rect.right - 18);
  const top = Math.round(rect.top + 74);
  /* 每次 render 都会调到这里，值没变就别碰 style，省一次样式重算 */
  if (left === tradeSlip.left && top === tradeSlip.top) return;
  tradeSlip.left = left;
  tradeSlip.top = top;
  tradeSlip.anchor.style.left = `${left}px`;
  tradeSlip.anchor.style.top = `${top}px`;
}

/* 一个玩家在屏幕上的落点，按可信度依次退让：
   他那一行 → 我自己的手牌区 → 顶栏的当前玩家 → 「玩家」页签 → 桌面中央。
   人少的时候「玩家」页签常常没打开，行量出来是 0，所以要有后面几级兜底；
   页签比桌面中央有指向性 —— 至少知道货是往「那边那个人」去的。 */
function playerAnchor(playerId, view) {
  const row = playerRowByPlayerId.get(playerId);
  if (row && row.getBoundingClientRect().width > 0) return elementCenter(row);
  if (playerId === HUMAN_ID && handDockElement?.getBoundingClientRect().width > 0) {
    return elementCenter(handDockElement);
  }
  if (view && playerId === view.currentPlayerId && currentPlayerElement) {
    return elementCenter(currentPlayerElement);
  }
  const tab = document.querySelector('[data-sidebar-tab="table"]');
  if (tab && tab.getBoundingClientRect().width > 0) return elementCenter(tab);
  return tableCenter();
}

function tradeSlipOrigin(view, fromPlayerId) {
  return playerAnchor(fromPlayerId, view);
}

function tradePoolChips(pool) {
  const wrap = document.createElement("span");
  wrap.className = "trade-pool";
  for (const [resource, amount] of Object.entries(pool)) {
    if (!(amount > 0)) continue;
    const chip = document.createElement("span");
    chip.className = "trade-pool-chip";
    appendResourceLabel(chip, resource, `${RESOURCE_LABELS[resource]} ${amount}`);
    wrap.append(chip);
  }
  return wrap;
}

function tradeNoteText(view, trade) {
  const responder = trade.currentResponderPlayerId;
  if (responder === null || responder === undefined) {
    /* 全场都拒了就别再写"可以成交"——那时候只剩取消这一条路 */
    const accepted = Object.values(trade.responses || {}).filter(
      (response) => response === "ACCEPTED",
    ).length;
    if (accepted === 0) return "无人接受，可以取消";
    return trade.fromPlayerId === HUMAN_ID
      ? "所有玩家已回应，可以成交"
      : "所有玩家已回应，等对方决定";
  }
  if (responder === HUMAN_ID) return "轮到你回应";
  return `等待 ${view.players[responder]?.name || "玩家"} 回应`;
}

function buildTradeSlip(view, trade) {
  const anchor = document.createElement("div");
  anchor.className = "trade-slip-anchor";
  const card = document.createElement("div");
  card.className = "trade-slip";
  card.dataset.tradeId = trade.tradeId;

  const from = document.createElement("span");
  from.className = "trade-slip-from";
  from.textContent = `${view.players[trade.fromPlayerId]?.name || "玩家"} 的报价`;

  const deal = document.createElement("p");
  deal.className = "trade-slip-deal";
  deal.append(tradePoolChips(trade.offer));
  const arrow = document.createElement("span");
  arrow.className = "trade-slip-arrow";
  arrow.textContent = "→";
  deal.append(arrow, tradePoolChips(trade.request));

  const targets = document.createElement("div");
  targets.className = "trade-slip-targets";
  const chips = new Map();
  for (const targetId of trade.targetPlayerIds) {
    const chip = document.createElement("span");
    chip.className = "trade-target is-pending";
    chip.dataset.playerId = String(targetId);
    const name = document.createElement("span");
    name.className = "trade-target-name";
    name.textContent = view.players[targetId]?.name || `P${targetId}`;
    const mark = document.createElement("span");
    mark.className = "trade-target-mark";
    mark.setAttribute("aria-hidden", "true");
    chip.append(name, mark);
    targets.append(chip);
    chips.set(targetId, chip);
  }

  const note = document.createElement("p");
  note.className = "trade-slip-note";

  /* 流局那道斜线：平时 scaleX(0) 藏着，取消时拉出来 */
  const strike = document.createElement("span");
  strike.className = "trade-slip-strike";
  strike.setAttribute("aria-hidden", "true");

  card.append(from, deal, targets, note, strike);
  anchor.append(card);
  return { anchor, card, chips, note };
}

/* 这笔交易是怎么结束的。开着的状态读 view.trade，结束那一下读事件 —— 
   成交和取消是"一次性动作"，没有对应的状态可读。 */
function tradeExitFor(events) {
  for (const event of events || []) {
    if (event.type === "TRADE_COMPLETED") return { mode: "done", payload: event.payload || {} };
    if (event.type === "TRADE_CANCELLED") return { mode: "void", payload: event.payload || {} };
  }
  return null;
}

/* 对手的手牌数字跟着滚一下：行里显示的是「手牌 N」，所以从 N-Δ 滚到 N。
   我自己那一格由 playHandDelta 负责，这里跳过。 */
function rollTradeHand(view, playerId, exchange, iAmInitiator) {
  if (playerId === HUMAN_ID) return;
  const row = playersElement.querySelector(`.player-row[data-player-id="${playerId}"]`);
  const player = view.players?.[playerId];
  const text = row?.querySelector(".resource-row .chip-text");
  if (!row || !player || !text || text.dataset.rolling === "1") return;
  const gained = totalPool(iAmInitiator ? exchange.request : exchange.offer);
  const lost = totalPool(iAmInitiator ? exchange.offer : exchange.request);
  const delta = gained - lost;
  if (!delta) return;
  pulseClass(row, "player-row-gain", MOTION.beat);
  rollHandNumber(
    text,
    Math.max(0, player.resourceCount - delta),
    player.resourceCount,
    (value) => `手牌 ${value}`,
  );
}

/* 成交：货从小票发出去，收下的人不是我，就用顺手牌那一套飞一张过去
   （我自己那一份由 playHandDelta 接住，不再画第二遍）。 */
function playTradeSettlement(view, exit, card) {
  const payload = exit.payload || {};
  const participants = Array.isArray(payload.participants) ? payload.participants : [];
  if (participants.length !== 2) return;
  const exchange = payload.exchange || { offer: {}, request: {} };
  const [initiatorId, targetId] = participants;
  const rect = card.getBoundingClientRect();
  const start = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  const legs = [
    { to: targetId, goods: exchange.offer },
    { to: initiatorId, goods: exchange.request },
  ];
  let delay = 0;
  for (const leg of legs) {
    if (leg.to === HUMAN_ID) continue;
    const target = playerAnchor(leg.to, view);
    for (const [resource, amount] of Object.entries(leg.goods || {})) {
      if (!(amount > 0)) continue;
      for (let index = 0; index < Math.min(amount, 4); index += 1) {
        flyHandCard({ resource, start, target, delay, incoming: true });
        delay += 110;
      }
    }
  }
  rollTradeHand(view, initiatorId, exchange, true);
  rollTradeHand(view, targetId, exchange, false);
  sound.play("deal");
}

function flyTradeSlip(view, trade, card) {
  if (prefersReducedMotion()) return;
  const origin = tradeSlipOrigin(view, trade.fromPlayerId);
  const box = card.getBoundingClientRect();
  const dx = Math.round(origin.x - (box.left + box.width / 2));
  const dy = Math.round(origin.y - (box.top + box.height / 2));
  card.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(1.06) rotate(-10deg)`, opacity: 0 },
      {
        transform: `translate(${Math.round(dx * 0.42)}px, ${Math.round(dy * 0.42)}px) scale(1.02) rotate(-4deg)`,
        opacity: 1,
        offset: 0.58,
      },
      { transform: "translate(0px, 0px) scale(1) rotate(0deg)", opacity: 1 },
    ],
    { duration: MOTION.carry, easing: MOTION.ease.out },
  );
}

function dismissTradeSlip(exit, view) {
  if (!tradeSlip) return;
  const { anchor, card } = tradeSlip;
  tradeSlip = null;

  /* 成交：先把货发出去，再让纸回到发起者手里 */
  if (exit?.mode === "done") {
    playTradeSettlement(view, exit, card);
    if (prefersReducedMotion()) {
      anchor.remove();
      return;
    }
    const initiatorId = (exit.payload.participants || [])[0];
    const home = playerAnchor(initiatorId, view);
    const rect = card.getBoundingClientRect();
    const dx = Math.round(home.x - (rect.left + rect.width / 2));
    const dy = Math.round(home.y - (rect.top + rect.height / 2));
    const back = card.animate(
      [
        { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${Math.round(dx * 0.5)}px, ${Math.round(dy * 0.5)}px) scale(0.97) rotate(-4deg)`,
          opacity: 1,
          offset: 0.6,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.86) rotate(-8deg)`, opacity: 0 },
      ],
      { duration: MOTION.reel, easing: MOTION.ease.inout },
    );
    back.finished.then(() => anchor.remove()).catch(() => anchor.remove());
    return;
  }

  /* 取消或流局：划一道斜线，再收走 */
  if (exit?.mode === "void") {
    card.classList.add("is-void");
    sound.play("close");
    if (prefersReducedMotion()) {
      anchor.remove();
      return;
    }
    window.setTimeout(() => anchor.remove(), MOTION.stamp + 20);
    return;
  }

  if (prefersReducedMotion()) {
    anchor.remove();
    return;
  }
  const fade = card.animate(
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)", opacity: 1 },
      { transform: "translate(0, -8px) scale(0.96) rotate(-2deg)", opacity: 0 },
    ],
    { duration: MOTION.base, easing: MOTION.ease.soft },
  );
  fade.finished.then(() => anchor.remove()).catch(() => anchor.remove());
}

/* 轮到我回应：小票朝「玩家」面板那边偏一下，我那一行亮一下，再补一声轻音。 */
function askForTradeResponse() {
  if (!tradeSlip || tradeSlip.asked !== HUMAN_ID) return;
  pulseClass(tradeSlip.card, "trade-slip-ask", MOTION.carry);
  const row = playerRowByPlayerId.get(HUMAN_ID);
  if (row) pulseClass(row, "player-row-turn", MOTION.hold);
  sound.play("turn");
}

function syncTradeSlip(view, events) {
  const trade = view.trade;
  if (!trade) {
    dismissTradeSlip(tradeExitFor(events), view);
    return;
  }

  if (!tradeSlip || tradeSlip.tradeId !== trade.tradeId) {
    dismissTradeSlip();
    const built = buildTradeSlip(view, trade);
    tradeSlipRoot().append(built.anchor);
    tradeSlip = {
      tradeId: trade.tradeId,
      states: new Map(),
      asked: null,
      left: null,
      top: null,
      ...built,
    };
    positionTradeSlip();
    flyTradeSlip(view, trade, built.card);
    sound.play("paper");
  } else {
    positionTradeSlip();
  }

  /* 每枚对象牌照着 responses 翻面；翻的那一下才出声、才盖戳 */
  for (const [playerId, chip] of tradeSlip.chips) {
    const state = trade.responses?.[playerId] || "PENDING";
    const previous = tradeSlip.states.get(playerId) || "PENDING";
    chip.classList.toggle("is-pending", state === "PENDING");
    chip.classList.toggle("is-accepted", state === "ACCEPTED");
    chip.classList.toggle("is-rejected", state === "REJECTED");
    chip.classList.toggle("is-current", trade.currentResponderPlayerId === playerId);
    chip.querySelector(".trade-target-mark").textContent =
      state === "ACCEPTED" ? "✓" : state === "REJECTED" ? "✕" : "";
    if (state !== previous) {
      tradeSlip.states.set(playerId, state);
      if (state === "ACCEPTED" || state === "REJECTED") {
        pulseClass(chip, "trade-target-stamp", MOTION.stamp);
        sound.play(state === "ACCEPTED" ? "stamp-yes" : "stamp-no");
      }
    }
  }

  tradeSlip.note.textContent = tradeNoteText(view, trade);

  /* 轮到我回应：小票朝我这一行偏一下，我那一行亮一下 */
  const asked = trade.currentResponderPlayerId ?? null;
  if (asked !== tradeSlip.asked) {
    const fresh = tradeSlip.asked === null;
    tradeSlip.asked = asked;
    if (asked === HUMAN_ID) {
      /* 刚上桌就先问我：等小票飞到位再提示，两个动画叠在同一层会打架 */
      if (fresh) window.setTimeout(askForTradeResponse, 560);
      else askForTradeResponse();
    }
  }
}

function developmentStatus(view, buyCommand) {
  if (view.currentPlayerId !== HUMAN_ID) return "等待当前玩家";
  if (view.phase === GAME_PHASES.AWAITING_ROLL) return "掷骰后可购买";
  if (view.developmentDeckCount <= 0) return "牌堆已空";
  if (!buyCommand) return "资源不足：羊毛 1、小麦 1、矿石 1";
  return "可购买：羊毛 1、小麦 1、矿石 1";
}

function developmentCommandLabel(command, view) {
  if (command.type === "REVEAL_VICTORY_POINT") {
    return "公开胜利点卡";
  }

  const card = view.players[HUMAN_ID].developmentCards?.find(
    (candidate) => candidate.id === command.cardId,
  );
  const label = DEVELOPMENT_CARD_LABELS[card?.type] || "发展卡";
  if (command.type === "PLAY_MONOPOLY") {
    return `${label}：${RESOURCE_LABELS[command.resource]}`;
  }
  return `使用${label}`;
}

function renderDiscardChoices(view, required) {
  const player = view.players[HUMAN_ID];
  const selectedTotal = Object.values(discardSelection.resources).reduce(
    (total, amount) => total + amount,
    0,
  );
  discardSummaryElement.textContent = `需弃 ${required} 张，已选 ${selectedTotal} 张`;
  discardResourceListElement.replaceChildren();

  for (const resource of RESOURCES) {
    const row = document.createElement("div");
    row.className = "resource-choice";

    const label = document.createElement("span");
    appendResourceLabel(label, resource, `${RESOURCE_LABELS[resource]} ${player.resources[resource]}`);

    const decrease = document.createElement("button");
    decrease.type = "button";
    decrease.textContent = "-";
    decrease.disabled = discardSelection.resources[resource] <= 0;
    decrease.addEventListener("click", () => {
      discardSelection.resources[resource] -= 1;
      render();
    });

    const selected = document.createElement("span");
    selected.textContent = `${discardSelection.resources[resource]}`;

    const increase = document.createElement("button");
    increase.type = "button";
    increase.textContent = "+";
    increase.disabled =
      selectedTotal >= required ||
      discardSelection.resources[resource] >= player.resources[resource];
    increase.addEventListener("click", () => {
      discardSelection.resources[resource] += 1;
      render();
    });

    row.append(label, decrease, selected, increase);
    discardResourceListElement.append(row);
  }

  confirmDiscardButton.disabled = selectedTotal !== required;
}

function confirmDiscard() {
  if (!discardSelection) return;
  const command = {
    type: "DISCARD_RESOURCES",
    resources: { ...discardSelection.resources },
  };
  discardSelection = null;
  dispatchHuman(command);
}

function renderBoard(view) {
  /* 棋盘重画说明局面变了，未确认的落子确认牌跟着收起 */
  closePlacementConfirm();
  boardElement.replaceChildren();
  placementPreviewLayer = null;
  if (!view.board) return;

  const { board } = view;
  const bounds = getBoardBounds(board);
  /* 留白要放得下港口的牌面：牌沿边的外法线立着，最宽的那块顶到 5.07 个单位，
     所以这里比 0.7 多一点，避免最外侧港口的牌被切掉。 */
  boardElement.setAttribute(
    "viewBox",
    `${bounds.minX - 0.8} ${bounds.minZ - 0.8} ${bounds.width + 1.6} ${bounds.height + 1.6}`,
  );

  /* ---------- 地面层：岸线沙滩 + 地块投影 ----------
     还没画地块，先把"地"铺好。这两样都只能靠叠多边形做：
     棋盘 viewBox 只有 10 个单位宽，CSS filter / drop-shadow 在这里会被
     算成错误的滤镜区域（踩过，整块棋盘会变成黑块），所以一律用形状堆。 */
  appendBoardGroup(view, "ground-layer", (group) => {
    /* 沙滩：只铺在海岸那圈边上（一条边只属于一个地块 = 岛的轮廓）。
       沙带压在边的正中，地块后画会盖掉内侧一半，露出来的正好是岸上的沙。
       外面再垫一条更宽更淡的，像浅水下的沙脊。 */
    for (const edge of board.edges) {
      if (edge.hexIds.length !== 1) continue;
      const first = board.vertices[edge.v1];
      const second = board.vertices[edge.v2];
      const span = {
        x1: first.x,
        y1: first.z,
        x2: second.x,
        y2: second.z,
      };
      appendSvg(group, "line", { ...span, class: "shore-shelf" });
      appendSvg(group, "line", { ...span, class: "shore-sand" });
    }

    /* 投影：每个六边形一份，往右下偏一点 —— 和界面里那套 2px 硬投影同一个光源。
       没有模糊可用，就叠两层不同深度：外圈浅、内圈深，边缘读起来是软的。
       所有投影先画完再画地块，所以它们只会落在海面上（岛内彼此盖住），
       整座岛看起来是一块浮在海上的板。 */
    for (const hex of board.hexes) {
      const points = hexPolygonPoints(board, hex);
      appendSvg(group, "polygon", {
        points,
        class: "hex-lift is-far",
        transform: "translate(0.05 0.075)",
      });
      appendSvg(group, "polygon", {
        points,
        class: "hex-lift is-near",
        transform: "translate(0.025 0.04)",
      });
    }
  });

  appendBoardGroup(view, "hex-layer", (group) => {
    for (const hex of board.hexes) {
      const points = hexPolygonPoints(board, hex);
      const hexShape = appendSvg(group, "polygon", {
        points,
        fill: TERRAIN_COLORS[hex.terrain],
        class: "hex-terrain",
        /* 给飞牌这类表现层用来定位地块在屏幕上的位置 */
        "data-hex": hex.id,
      });
      appendSvgTitle(
        hexShape,
        `${hex.terrain}${hex.resource ? ` · ${RESOURCE_LABELS[hex.resource]}` : ""}${hex.number ? ` · ${hex.number}` : ""}`,
      );

      /* 每块地自己的立体感：光源固定在左上，所以右下压一条深、左上提一条亮。
         两条都是内阴影（见 hexReliefPath），叠在地块上、地形图案和数字牌下面，
         所以不会糊住地形和数字。颜色很淡 —— 要的是"微微浮起来"，不是浮雕。 */
      appendSvg(group, "path", {
        d: hexReliefPath(board, hex, -0.05, -0.055),
        "fill-rule": "evenodd",
        class: "hex-relief is-shade",
      });
      appendSvg(group, "path", {
        d: hexReliefPath(board, hex, 0.045, 0.05),
        "fill-rule": "evenodd",
        class: "hex-relief is-light",
      });

      /* 收成高光层：盖在地块上、垫在图案和数字牌下面。
         用额外多边形只动 opacity —— 不给地块本身加 filter 或改 fill，
         那两样在这个 10 单位的 viewBox 下都不好收场（踩过）。 */
      if (hex.number) {
        appendSvg(group, "polygon", {
          points,
          class: "hex-harvest",
          "data-hex": hex.id,
          "data-number": hex.number,
        });
      }

      appendTerrainMotif(group, hex);

      if (hex.number) {
        const high = hex.number === 6 || hex.number === 8;
        if (high) {
          // 暗红木牌要有一点厚度：先垫一层略大的半透明暗圈当阴影（不用 CSS filter，
          // 那在这套 viewBox 下会把棋盘算崩）
          appendSvg(group, "circle", {
            cx: hex.x,
            cy: hex.z + 0.022,
            r: 0.275,
            class: "number-token-shadow",
          });
        }
        appendSvg(group, "circle", {
          cx: hex.x,
          cy: hex.z,
          r: 0.255,
          class: `number-token${high ? " high" : ""}`,
        });
        appendSvg(group, "text", {
          x: hex.x,
          y: hex.z - 0.025,
          class: `hex-number${high ? " high" : ""}`,
          text: String(hex.number),
        });
        if (hex.resource) {
          appendSvg(group, "text", {
            x: hex.x,
            y: hex.z + 0.145,
            class: `resource-mark${high ? " high" : ""}`,
            text: RESOURCE_MARKS[hex.resource] || RESOURCE_LABELS[hex.resource],
          });
        }
      }
    }
  });

  appendBoardGroup(view, "harbor-layer", (group) => {
    for (const harbor of board.harbors) {
      /* 牌面立在这条边的中点，沿边的外法线朝外——不能顺着半径推，
         半径和边不垂直，推出去会顺着海岸滑到旁边，看着就不在边中间。 */
      const plateEdge = board.edges[harbor.edgeId];
      let normalX;
      let normalZ;
      if (plateEdge) {
        const first = board.vertices[plateEdge.v1];
        const second = board.vertices[plateEdge.v2];
        normalX = second.z - first.z;
        normalZ = -(second.x - first.x);
      } else {
        normalX = harbor.x;
        normalZ = harbor.z;
      }
      const normalLength = Math.hypot(normalX, normalZ) || 1;
      normalX /= normalLength;
      normalZ /= normalLength;
      // 法线有两条，取背离棋盘中心（原点）的那条
      if (normalX * harbor.x + normalZ * harbor.z < 0) {
        normalX = -normalX;
        normalZ = -normalZ;
      }

      const ratio = harbor.type === "any" ? "3:1" : "2:1";
      const label = harbor.type === "any" ? ratio : `${RESOURCE_MARKS[harbor.type]}${ratio}`;
      const plateWidth = harborPlateWidth(label);
      /* 沿法线看，牌面边界离牌心多远——斜着的海岸边上，挡在桅杆前面的是牌的半高而不是半宽 */
      const halfWidth = plateWidth / 2;
      const halfHeight = HARBOR_PLATE_H / 2;
      const reach = Math.min(
        Math.abs(normalX) > 1e-6 ? halfWidth / Math.abs(normalX) : Infinity,
        Math.abs(normalZ) > 1e-6 ? halfHeight / Math.abs(normalZ) : Infinity,
      );
      const offset = reach + HARBOR_POST;
      const plateX = harbor.x + normalX * offset;
      const plateY = harbor.z + normalZ * offset;

      // 桅杆：从海岸边中点伸进牌面里，交代这块牌挂在哪条边上
      appendSvg(group, "line", {
        x1: harbor.x,
        y1: harbor.z,
        x2: plateX,
        y2: plateY,
        class: "harbor-mast",
      });
      const harborPlate = appendSvg(group, "rect", {
        x: plateX - plateWidth / 2,
        y: plateY - HARBOR_PLATE_H / 2,
        width: plateWidth,
        height: HARBOR_PLATE_H,
        rx: 0.05,
        ry: 0.05,
        class: "harbor-plate",
      });
      const harborText = appendSvg(group, "text", {
        x: plateX,
        y: plateY,
        class: "harbor-label",
        text: label,
      });
      /* 牌面本身当悬停靶子：文字是 pointer-events:none，靶子放在牌上才有提示 */
      harborText.setAttribute("aria-hidden", "true");
      appendSvgTitle(
        harborPlate,
        harbor.type === "any" ? "任意资源港口 3:1" : `${RESOURCE_LABELS[harbor.type]}港口 2:1`,
      );
    }
  });

  appendBoardGroup(view, "road-layer", (group) => {
    for (const edge of board.edges) {
      const first = board.vertices[edge.v1];
      const second = board.vertices[edge.v2];

      if (edge.road) {
        const player = view.players[edge.road.playerId];
        // 外发光：先垫一条更宽的暖白线，上面那层墨色描边保持不动
        appendSvg(group, "line", {
          x1: first.x,
          y1: first.z,
          x2: second.x,
          y2: second.z,
          class: "road-glow",
          "stroke-width": 0.17,
        });
        appendSvg(group, "line", {
          x1: first.x,
          y1: first.z,
          x2: second.x,
          y2: second.z,
          class: "road-shadow",
        });
        const roadLine = appendSvg(group, "line", {
          x1: first.x,
          y1: first.z,
          x2: second.x,
          y2: second.z,
          stroke: player.color,
          class: "road road-color",
        });
        appendSvgTitle(roadLine, `${player.name} 的道路`);
      }
    }

    if (view.currentPlayerId !== HUMAN_ID) return;
    for (const command of view.validCommands) {
      const isRoadCommand =
        command.type === "PLACE_INITIAL_ROAD" ||
        command.type === "PLACE_FREE_ROAD" ||
        (command.type === "BUILD_ROAD" && selectedBuild === "road");
      if (!isRoadCommand) continue;
      const edge = board.edges[command.edgeId];
      const first = board.vertices[edge.v1];
      const second = board.vertices[edge.v2];
      const midX = (first.x + second.x) / 2;
      const midZ = (first.z + second.z) / 2;

      /* 道路的候选点就是那条边本身：平时一根虚线，指到就收成实线，正好是放下去的样子 */
      const marker = appendPlacementMarker(
        group,
        "valid-road-target marker-road",
        midX,
        midZ,
        command.type === "PLACE_FREE_ROAD"
          ? "放置免费道路"
          : `建造道路：${formatCost(BUILD_COSTS.road)}`,
        0.15,
      );
      appendSvg(marker, "line", {
        x1: (first.x - midX).toFixed(3),
        y1: (first.z - midZ).toFixed(3),
        x2: (second.x - midX).toFixed(3),
        y2: (second.z - midZ).toFixed(3),
        stroke: view.players[HUMAN_ID].color,
        class: "marker-line",
      });
      appendSvg(marker, "circle", { r: 0.12, class: "marker-ring" });

      bindPlacementMarker(marker, { kind: "road" }, () =>
        openPlacementConfirm(
          command,
          midX,
          midZ,
          command.type === "PLACE_FREE_ROAD" ? "放置免费道路" : "确认建造道路",
        ),
      );
    }
  });

  appendBoardGroup(view, "building-layer", (group) => {
    for (const vertex of board.vertices) {
      if (vertex.building) {
        const player = view.players[vertex.building.playerId];
        const building = appendBuildingShape(group, vertex, player);
        appendSvgTitle(
          building,
          `${player.name} · ${vertex.building.type === "city" ? "城市" : "定居点"}`,
        );
      }
    }

    if (view.currentPlayerId !== HUMAN_ID) return;
    for (const command of view.validCommands) {
      const isSettlementCommand =
        command.type === "PLACE_INITIAL_SETTLEMENT" ||
        (command.type === "BUILD_SETTLEMENT" && selectedBuild === "settlement");
      if (!isSettlementCommand) continue;
      const vertex = board.vertices[command.vertexId];
      const marker = appendPlacementMarker(
        group,
        "valid-target marker-settlement",
        vertex.x,
        vertex.z,
        `建造${buildLabel("settlement")}：${formatCost(BUILD_COSTS.settlement)}`,
        0.17,
      );
      appendSvg(marker, "circle", { r: 0.15, class: "marker-ring" });
      /* 中心点用玩家色：一眼看出这是自己要落的子 */
      appendSvg(marker, "circle", {
        r: 0.04,
        fill: view.players[HUMAN_ID].color,
        class: "marker-dot",
      });
      bindPlacementMarker(
        marker,
        {
          kind: "settlement",
          x: vertex.x,
          z: vertex.z,
          player: view.players[HUMAN_ID],
        },
        () =>
          openPlacementConfirm(
            command,
            vertex.x,
            vertex.z,
            command.type === "PLACE_INITIAL_SETTLEMENT"
              ? "确认放置定居点"
              : "确认建造定居点",
          ),
      );
    }

    for (const command of view.validCommands) {
      if (command.type !== "BUILD_CITY" || selectedBuild !== "city") continue;
      const vertex = board.vertices[command.vertexId];
      const marker = appendPlacementMarker(
        group,
        "valid-target valid-city-target marker-city",
        vertex.x,
        vertex.z,
        `升级城市：${formatCost(BUILD_COSTS.city)}`,
        0.22,
      );
      appendSvg(marker, "circle", { r: 0.2, class: "marker-ring" });
      appendSvg(marker, "circle", { r: 0.045, class: "marker-dot" });
      bindPlacementMarker(
        marker,
        { kind: "city", x: vertex.x, z: vertex.z, player: view.players[HUMAN_ID] },
        () => openPlacementConfirm(command, vertex.x, vertex.z, "确认升级为城市"),
      );
    }
  });

  /* 预览层：hover 时画“放下去会是什么样”的幽灵件。
     压在建筑之上，这样城市升级的预览能盖住底下那个定居点。 */
  appendBoardGroup(view, "preview-layer", (group) => {
    placementPreviewLayer = group;
  });

  appendBoardGroup(view, "effect-layer", (group) => {
    const robberHex = board.hexes[view.robberHexId];
    if (robberHex) {
      /* 坐在数字令牌旁边的兜帽人形：地面影 + 一圈深色柔光 + 斗篷 + 帽兜里那个暗孔。
         横向偏移要盖过牌面半宽（0.255）加人形半宽（0.19），0.46 是留了余量后的值；
         沙漠没有令牌，站回正中。
         定位放在外层锚点上：robber-move 动画走的是 CSS transform，
         它会盖掉同元素上的 transform 属性，放在一起会把强盗拽到棋盘中心。 */
      const robberShift = robberHex.number ? 0.46 : 0;
      const robberAnchor = appendSvg(group, "g", {
        transform: `translate(${(robberHex.x + robberShift).toFixed(3)} ${(robberHex.z - 0.02).toFixed(3)})`,
      });
      const robberMark = appendSvg(robberAnchor, "g", { class: "robber" });
      /* 柔光不用 filter —— 这个 viewBox 只有 10 个单位宽，滤镜会被算崩。
         改成两层同心圆叠出衰减；圆心必须落在人形的视觉中心 (0, -0.21)，
         以前写的是 (0.04, -0.1)，人缩在光斑左上角，看着就是"光圈没套住人"。 */
      appendSvg(robberMark, "ellipse", {
        cx: 0,
        cy: 0.015,
        rx: 0.2,
        ry: 0.055,
        class: "robber-shadow",
      });
      appendSvg(robberMark, "circle", { cx: 0, cy: -0.21, r: 0.25, class: "robber-halo" });
      appendSvg(robberMark, "circle", {
        cx: 0,
        cy: -0.21,
        r: 0.185,
        class: "robber-halo is-inner",
      });
      /* 斗篷：下摆最宽，往上收到肩，再收成帽兜。
         小尺寸下认不认得出是人，全靠这个轮廓。 */
      appendSvg(robberMark, "path", {
        d:
          "M-0.17 0C-0.165-0.08-0.15-0.16-0.135-0.22" +
          "C-0.1-0.24-0.085-0.245-0.085-0.265" +
          "C-0.105-0.3-0.11-0.35 0-0.42" +
          "C0.11-0.35 0.105-0.3 0.085-0.265" +
          "C0.085-0.245 0.1-0.24 0.135-0.22" +
          "C0.15-0.16 0.165-0.08 0.17 0Z",
        class: "robber-cloak",
      });
      /* 帽兜里那张脸。必须是亮的：这块人形只有 13 像素高，
         暗孔等于没有，整块暗形就只剩"一个三角"；一小片亮面才读得出是兜帽。 */
      appendSvg(robberMark, "ellipse", {
        cx: 0,
        cy: -0.33,
        rx: 0.058,
        ry: 0.05,
        class: "robber-cowl",
      });
    }

    if (view.currentPlayerId !== HUMAN_ID) return;
    for (const command of view.validCommands) {
      if (command.type !== "MOVE_ROBBER") continue;
      const hex = board.hexes[command.hexId];
      const marker = appendPlacementMarker(
        group,
        "robber-target marker-robber",
        hex.x,
        hex.z,
        `移动到地块 h${command.hexId}`,
        0.24,
      );
      appendSvg(marker, "circle", { r: 0.22, class: "marker-ring" });
      bindPlacementMarker(marker, { kind: "robber" }, () =>
        openPlacementConfirm(command, hex.x, hex.z, "确认移动强盗"),
      );
    }
  });
}

function appendTerrainMotif(parent, hex) {
  if (!hex.terrain) return;
  const motif = appendSvg(parent, "g", {
    class: `terrain-motif motif-${hex.terrain}`,
    transform: `translate(${hex.x} ${hex.z})`,
  });

  if (hex.terrain === "forest") {
    appendTree(motif, -0.33, 0.31, 0.78);
    appendTree(motif, -0.03, 0.39, 0.9);
    appendTree(motif, 0.31, 0.28, 0.72);
    return;
  }

  if (hex.terrain === "hills") {
    appendSvg(motif, "path", {
      d: "M -0.46 0.42 Q -0.32 0.05 -0.14 0.42 Z",
      class: "motif-fill",
    });
    appendSvg(motif, "path", {
      d: "M -0.16 0.44 Q 0.02 0.08 0.22 0.44 Z",
      class: "motif-fill motif-light",
    });
    appendSvg(motif, "path", {
      d: "M 0.14 0.42 Q 0.3 0.16 0.47 0.42 Z",
      class: "motif-fill",
    });
    return;
  }

  if (hex.terrain === "pasture") {
    appendSvg(motif, "path", {
      d: "M -0.42 0.42 q 0.04 -0.17 0.1 -0.23 m -0.03 0.1 l 0.08 -0.08 m -0.08 0.08 l -0.09 -0.07",
      class: "motif-line",
    });
    appendSvg(motif, "path", {
      d: "M 0.32 0.43 q 0.02 -0.16 0.11 -0.24 m -0.02 0.1 l 0.08 -0.08 m -0.08 0.08 l -0.08 -0.08",
      class: "motif-line",
    });
    appendSheep(motif, -0.22, 0.3);
    appendSheep(motif, 0.18, 0.22);
    return;
  }

  if (hex.terrain === "fields") {
    for (const [x, y, height] of [
      [-0.34, 0.41, 0.28],
      [0, 0.45, 0.34],
      [0.34, 0.4, 0.26],
    ]) {
      appendSvg(motif, "line", {
        x1: x,
        y1: y,
        x2: x,
        y2: y - height,
        class: "motif-line",
      });
      appendSvg(motif, "circle", {
        cx: x - 0.055,
        cy: y - height + 0.07,
        r: 0.045,
        class: "motif-fill",
      });
      appendSvg(motif, "circle", {
        cx: x + 0.055,
        cy: y - height + 0.13,
        r: 0.045,
        class: "motif-fill",
      });
    }
    return;
  }

  if (hex.terrain === "mountains") {
    appendMountain(motif, -0.28, 0.42, 0.42);
    appendMountain(motif, 0.04, 0.46, 0.55);
    appendMountain(motif, 0.33, 0.4, 0.36);
    return;
  }

  if (hex.terrain === "desert") {
    appendSvg(motif, "path", {
      d: "M -0.44 0.39 Q -0.28 0.17 -0.1 0.39 Q 0.08 0.18 0.28 0.39 Q 0.39 0.3 0.48 0.39",
      class: "motif-line",
    });
    appendSvg(motif, "path", {
      d: "M -0.3 0.23 Q -0.18 0.1 -0.04 0.23",
      class: "motif-line",
    });
  }
}

function appendTree(parent, x, y, scale) {
  appendSvg(parent, "line", {
    x1: x,
    y1: y,
    x2: x,
    y2: y + 0.09 * scale,
    class: "motif-line",
  });
  appendSvg(parent, "polygon", {
    points: `${x},${y - 0.23 * scale} ${x - 0.13 * scale},${y} ${x + 0.13 * scale},${y}`,
    class: "motif-fill",
  });
}

function appendSheep(parent, x, y) {
  appendSvg(parent, "ellipse", {
    cx: x,
    cy: y,
    rx: 0.105,
    ry: 0.065,
    class: "motif-fill",
  });
  appendSvg(parent, "circle", {
    cx: x + 0.085,
    cy: y - 0.035,
    r: 0.045,
    class: "motif-fill",
  });
  for (const offset of [-0.055, 0.045]) {
    appendSvg(parent, "line", {
      x1: x + offset,
      y1: y + 0.055,
      x2: x + offset,
      y2: y + 0.105,
      class: "motif-line",
    });
  }
}

function appendMountain(parent, x, y, height) {
  appendSvg(parent, "polygon", {
    points: `${x},${y - height} ${x - 0.24},${y} ${x + 0.24},${y}`,
    class: "motif-fill",
  });
  appendSvg(parent, "polygon", {
    points: `${x},${y - height} ${x - 0.075},${y - height * 0.62} ${x},${y - height * 0.76} ${x + 0.075},${y - height * 0.62}`,
    class: "motif-light",
  });
}

function appendBuildingShape(parent, vertex, player) {
  const group = appendSvg(parent, "g", {
    class: `building settlement ${vertex.building.type}`,
    transform: `translate(${vertex.x} ${vertex.z})`,
  });
  // 定居点 / 城市的外发光：一圈比本体略大的暖白椭圆，垫在最底下
  appendSvg(group, "ellipse", {
    cx: 0,
    cy: 0.05,
    rx: vertex.building.type === "city" ? 0.3 : 0.23,
    ry: vertex.building.type === "city" ? 0.26 : 0.2,
    class: "building-glow",
  });
  appendSvg(group, "ellipse", {
    cx: 0,
    cy: 0.14,
    rx: vertex.building.type === "city" ? 0.23 : 0.16,
    ry: 0.055,
    class: "building-shadow",
  });
  const shell = appendSvg(group, "g", { class: "building-shell" });

  if (vertex.building.type === "city") {
    appendSvg(shell, "path", {
      d: "M -0.21 0.14 L -0.21 -0.05 L -0.13 -0.05 L -0.13 -0.12 L -0.05 -0.12 L -0.05 -0.2 L 0.05 -0.2 L 0.05 -0.12 L 0.13 -0.12 L 0.13 -0.05 L 0.21 -0.05 L 0.21 0.14 Z",
      fill: player.color,
      class: "building-shape",
    });
    appendSvg(shell, "rect", {
      x: -0.035,
      y: 0.015,
      width: 0.07,
      height: 0.125,
      rx: 0.015,
      class: "building-detail",
    });
    appendSvg(shell, "rect", {
      x: -0.16,
      y: -0.01,
      width: 0.06,
      height: 0.06,
      rx: 0.012,
      class: "building-detail",
    });
    appendSvg(shell, "rect", {
      x: 0.1,
      y: -0.01,
      width: 0.06,
      height: 0.06,
      rx: 0.012,
      class: "building-detail",
    });
    return group;
  }

  appendSvg(shell, "polygon", {
    points: "0,-0.18 -0.17,0 0.17,0",
    fill: player.color,
    class: "building-shape",
  });
  appendSvg(shell, "rect", {
    x: -0.115,
    y: -0.005,
    width: 0.23,
    height: 0.145,
    rx: 0.018,
    fill: "#f4ead2",
    class: "building-shape",
  });
  appendSvg(shell, "rect", {
    x: -0.035,
    y: 0.045,
    width: 0.07,
    height: 0.095,
    rx: 0.012,
    fill: player.color,
    class: "building-shape",
  });
  return group;
}

function dispatchHuman(command) {
  if (isSpectating) return;
  if (session?.isRemote) {
    session.dispatch(HUMAN_ID, command);
    if (command.type?.startsWith("BUILD_")) selectedBuild = null;
    return;
  }

  const result = session.dispatch(HUMAN_ID, command);
  if (!result.accepted && result.error) {
    setActionHint(`命令被拒绝：${result.error.code}`, "error");
  }
  if (result.accepted && command.type?.startsWith("BUILD_")) {
    selectedBuild = null;
  }
  render();
  scheduleBotTurn();
}

function selectBuild(buildType) {
  selectedBuild = selectedBuild === buildType ? null : buildType;
  render();
}

function buildLabel(buildType) {
  if (buildType === "road") return "道路";
  if (buildType === "settlement") return "定居点";
  return "城市";
}

function buildCommandType(buildType) {
  return `BUILD_${buildType.toUpperCase()}`;
}

function formatCost(cost) {
  return Object.entries(cost)
    .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
    .join("、");
}

/* 玩家行也只建一次，之后原地更新 —— 和手牌格同样的理由：
   每次 render 重建会把滚动中的「手牌 N」和落点脉冲一起换掉。
   结构形状变了（自己的 5 个资源格 ↔ 观战时只有「手牌 N」）才重建。 */
const playerRowByPlayerId = new Map();
let playerRowsShape = "";

function buildPlayerRow(player) {
  const row = document.createElement("div");
  row.className = "player-row";
  /* 给飞牌定位用：别人的收成要飞到他自己那一行 */
  row.dataset.playerId = String(player.id);

  const swatch = document.createElement("span");
  swatch.className = "swatch";

  const identity = document.createElement("div");
  const name = document.createElement("div");
  name.className = "player-name";
  const meta = document.createElement("div");
  meta.className = "player-meta";
  identity.append(name, meta);

  const vp = document.createElement("strong");
  vp.className = "player-vp";

  const resources = document.createElement("div");
  resources.className = "resource-row";
  if (player.resources) {
    for (const resource of RESOURCES) {
      const chip = document.createElement("span");
      chip.className = "resource-chip";
      resources.append(chip);
    }
  } else {
    const chip = document.createElement("span");
    chip.className = "resource-chip";
    const text = document.createElement("span");
    text.className = "chip-text";
    chip.append(text);
    resources.append(chip);
  }

  row.append(swatch, identity, vp, resources);
  playersElement.append(row);
  return row;
}

function renderPlayers(view) {
  /* 形状键要带上 id：换局后人数/座位变了必须重建，不然新玩家会找不到自己的行 */
  const shape = view.players
    .map((player) => `${player.id}:${player.resources ? "own" : "hidden"}`)
    .join("|");
  if (shape !== playerRowsShape) {
    playerRowsShape = shape;
    playerRowByPlayerId.clear();
    playersElement.replaceChildren();
    for (const player of view.players) {
      playerRowByPlayerId.set(player.id, buildPlayerRow(player));
    }
  }

  for (const player of view.players) {
    const row = playerRowByPlayerId.get(player.id);
    if (!row) continue;
    row.classList.toggle("current", player.id === view.currentPlayerId);
    row.querySelector(".swatch").style.background = player.color;
    row.querySelector(".player-name").textContent = `${player.name}${
      player.isBot ? ` (AI · ${difficultyLabel(player.difficulty)})` : ""
    }`;
    const awards = [
      view.awards.longestRoad === player.id ? "最长道路" : null,
      view.awards.largestArmy === player.id ? "最大军队" : null,
    ].filter(Boolean);
    row.querySelector(".player-meta").textContent =
      `定居点 ${player.settlements.length}/${PIECE_LIMITS.settlement} · ` +
      `城市 ${player.cities.length}/${PIECE_LIMITS.city} · ` +
      `道路 ${player.roads.length}/${PIECE_LIMITS.road} · ` +
      `发展卡 ${player.developmentCardCount}` +
      (awards.length > 0 ? ` · ${awards.join(" / ")}` : "");
    row.querySelector(".player-vp").textContent = `${player.victoryPoints} VP`;

    const chips = row.querySelectorAll(".resource-row .resource-chip");
    if (player.resources) {
      RESOURCES.forEach((resource, index) => {
        const chip = chips[index];
        if (!chip) return;
        appendResourceLabel(
          chip,
          resource,
          `${RESOURCE_LABELS[resource]} ${player.resources[resource]}`,
        );
      });
    } else {
      const text = chips[0]?.querySelector(".chip-text");
      /* 数字正在滚的别动它 */
      if (text && text.dataset.rolling !== "1") {
        const value = `手牌 ${player.resourceCount}`;
        if (text.textContent !== value) text.textContent = value;
      }
    }
  }
}

function renderEventLog(view) {
  eventLogElement.replaceChildren();
  const events = [...view.eventLog].reverse().slice(0, 30);
  for (const event of events) {
    const item = document.createElement("li");
    const sequence = document.createElement("time");
    sequence.textContent = `#${event.sequence}`;
    const message = document.createElement("span");
    message.textContent = formatEvent(event, view);
    // 带上事件类型，侧栏日志按类型上色（CSS 里用 [data-type] 区分）
    item.dataset.type = event.type;
    item.append(sequence, message);
    eventLogElement.append(item);
  }
}

function formatEvent(event, view) {
  const playerName = (playerId) => view.players[playerId]?.name || `P${playerId}`;
  switch (event.type) {
    case "GAME_STARTED":
      return `游戏开始，种子 ${event.payload.seed}`;
    case "BOARD_CREATED":
      return `生成 ${event.payload.hexCount} 格地图和 ${event.payload.harborCount} 个港口`;
    case "PHASE_CHANGED":
      return `阶段 ${event.payload.from} -> ${event.payload.to}`;
    case "TURN_STARTED":
      return event.payload.turnNumber
        ? `${playerName(event.payload.playerId)} 开始第 ${event.payload.turnNumber} 轮`
        : `${playerName(event.payload.playerId)} 开始放置`;
    case "SETTLEMENT_PLACED":
      return `${playerName(event.payload.playerId)} ${
        event.payload.isInitial ? "放置初始定居点" : "建造定居点"
      } v${event.payload.vertexId}`;
    case "ROAD_PLACED":
      return `${playerName(event.payload.playerId)} ${
        event.payload.isInitial ? "放置初始道路" : "建造道路"
      } e${event.payload.edgeId}`;
    case "CITY_PLACED":
      return `${playerName(event.payload.playerId)} 将定居点升级为城市 v${event.payload.vertexId}`;
    case "RESOURCES_SPENT": {
      const spent = Object.entries(event.payload.resources)
        .filter(([, amount]) => amount > 0)
        .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
        .join("、");
      const action =
        event.payload.buildType === "developmentCard"
          ? "购买发展卡"
          : `建造${buildLabel(event.payload.buildType)}`;
      return `${playerName(event.payload.playerId)} ${action}，消耗 ${spent}`;
    }
    case "RESOURCES_GAINED": {
      const gained = Object.entries(event.payload.resources)
        .filter(([, amount]) => amount > 0)
        .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
        .join("、");
      const source =
        event.payload.source === "DICE_ROLL"
          ? "资源生产"
          : event.payload.source === "YEAR_OF_PLENTY"
            ? "丰收之年"
            : event.payload.source === "STARTING_RESOURCES"
              ? "开局资源"
            : "初始资源";
      return `${playerName(event.payload.playerId)} 获得${source}：${gained}`;
    }
    case "DICE_ROLLED":
      return `${playerName(event.payload.playerId)} 掷出 ${event.payload.die1} + ${event.payload.die2} = ${event.payload.total}`;
    case "RESOURCES_PRODUCED": {
      const gains = event.payload.gains
        .map((gain) => `${playerName(gain.playerId)} +${gain.amount}`)
        .join("、");
      return `地块 h${event.payload.hexId} 生产 ${RESOURCE_LABELS[event.payload.resource]}：${gains}`;
    }
    case "BANK_RESOURCE_SHORTAGE":
      return `银行${RESOURCE_LABELS[event.payload.resource]}不足（需要 ${event.payload.requested}，可用 ${event.payload.available}），本次不发放`;
    case "DISCARD_REQUIRED":
      return `需要弃掉 ${event.payload.required} 张资源`;
    case "RESOURCES_DISCARDED": {
      const discarded = Object.entries(event.payload.resources)
        .filter(([, amount]) => amount > 0)
        .map(([resource, amount]) => `${RESOURCE_LABELS[resource]} ${amount}`)
        .join("、");
      return `${playerName(event.payload.playerId)} 弃掉 ${discarded}`;
    }
    case "DISCARD_COUNT_CHANGED":
      return event.payload.remaining === 0
        ? `${playerName(event.payload.playerId)} 已完成弃牌`
        : `${playerName(event.payload.playerId)} 需要弃掉 ${event.payload.remaining} 张`;
    case "ROBBER_MOVED":
      return `${playerName(event.payload.movedByPlayerId)} 将强盗移动到 h${event.payload.hexId}`;
    case "RESOURCE_LOST":
      return `被 ${playerName(event.payload.thiefId)} 偷走 1 张${RESOURCE_LABELS[event.payload.resource]}`;
    case "RESOURCE_STOLEN":
      return `从 ${playerName(event.payload.victimId)} 偷到 1 张${RESOURCE_LABELS[event.payload.resource]}`;
    case "STEAL_RESOLVED":
      return `${playerName(event.payload.thiefId)} 从 ${playerName(event.payload.victimId)} 偷取资源`;
    case "DEVELOPMENT_CARD_PURCHASED":
      return `${playerName(event.payload.playerId)} 购买了一张发展卡，牌堆剩余 ${event.payload.remaining}`;
    case "DEVELOPMENT_CARD_DRAWN":
      return `抽到${DEVELOPMENT_CARD_LABELS[event.payload.card.type] || "发展卡"}`;
    case "DEVELOPMENT_CARD_PLAYED":
      return `${playerName(event.payload.playerId)} 使用${DEVELOPMENT_CARD_LABELS[event.payload.cardType] || "发展卡"}`;
    case "ROAD_BUILDING_STARTED":
      return `${playerName(event.payload.playerId)} 可放置 ${event.payload.roadsRemaining} 条免费道路`;
    case "FREE_ROAD_PLACED":
      return `${playerName(event.payload.playerId)} 放置免费道路 e${event.payload.edgeId}`;
    case "YEAR_OF_PLENTY_STARTED":
      return `${playerName(event.payload.playerId)} 可选择 ${event.payload.choicesRemaining} 项资源`;
    case "MONOPOLY_RESOLVED":
      return `${playerName(event.payload.playerId)} 垄断${RESOURCE_LABELS[event.payload.resource]}，获得 ${event.payload.gains.reduce((sum, gain) => sum + gain.amount, 0)} 张`;
    case "VICTORY_POINT_REVEALED":
      return `${playerName(event.payload.playerId)} 公开 1 张胜利点卡`;
    case "LONGEST_ROAD_CHANGED":
      return event.payload.newPlayerId === null
        ? "最长道路奖励被收回"
        : `${playerName(event.payload.newPlayerId)} 获得最长道路（${event.payload.length}）`;
    case "LARGEST_ARMY_CHANGED":
      return event.payload.newPlayerId === null
        ? "最大军队奖励被收回"
        : `${playerName(event.payload.newPlayerId)} 获得最大军队（${event.payload.size}）`;
    case "BANK_TRADE_COMPLETED":
      return `${playerName(event.payload.playerId)} 完成 ${event.payload.ratio}:1 银行兑换`;
    case "TRADE_CREATED":
      return `${playerName(event.payload.fromPlayerId)} 发起交易：${formatTradePool(event.payload.offer)} -> ${formatTradePool(event.payload.request)}`;
    case "TRADE_RESPONSE_RECORDED":
      return `${playerName(event.payload.playerId)} ${event.payload.accepted ? "接受" : "拒绝"}交易`;
    case "TRADE_ROUND_COMPLETED":
      return "所有玩家已完成交易回应";
    case "TRADE_COMPLETED":
      return `交易完成：${event.payload.participants.map(playerName).join(" 与 ")}`;
    case "TRADE_CANCELLED":
      return `${playerName(event.payload.playerId)} 取消交易`;
    case "HAND_CHANGED":
      return `${playerName(event.payload.playerId)} 手牌已更新`;
    case "TURN_ENDED":
      return `${playerName(event.payload.playerId)} 结束第 ${event.payload.turnNumber} 轮行动`;
    case "VICTORY_POINTS_CHANGED":
      return `${playerName(event.payload.playerId)} 胜利点变为 ${event.payload.value}`;
    case "GAME_ENDED":
      return `${playerName(event.payload.winnerId)} 以 ${event.payload.victoryPoints} 分获胜`;
    case "SETUP_COMPLETED":
      return `初始放置完成，${playerName(event.payload.startingPlayerId)} 先行动`;
    default:
      return event.type;
  }
}

function renderCompletion(view) {
  if (view.phase === GAME_PHASES.GAME_OVER) {
    const winner = view.players[view.winnerId];
    completionElement.classList.remove("hidden");
    sound.play("win");
    setCompletion(
      winner
        ? `游戏结束：${winner.name} 以 ${winner.victoryPoints} VP 获胜。`
        : "游戏结束。",
      true,
    );
    return;
  }

  const complete =
    view.phase === GAME_PHASES.AWAITING_ROLL &&
    view.turnNumber === 1 &&
    !view.turn.hasRolled;
  completionElement.classList.toggle("hidden", !complete);
  if (complete) {
    setCompletion("第一阶段完成。现在可用右侧控件掷骰、结算资源并结束回合。", false);
  }
}

/* 结算浮层：终局时带一张头图（图片不存在就只显示纸底，不会出现裂图） */
function setCompletion(text, withArt) {
  const nodes = [];
  if (withArt) {
    const art = document.createElement("div");
    art.className = "completion-art";
    nodes.push(art);
  }
  const line = document.createElement("p");
  line.className = "completion-text";
  line.textContent = text;
  nodes.push(line);
  completionElement.replaceChildren(...nodes);
}

function appendBoardGroup(view, className, draw) {
  const group = appendSvg(boardElement, "g", { class: className });
  draw(group, view);
}

function appendSvgTitle(parent, text) {
  // 不生成 SVG <title>：那会弹出浏览器原生白气泡，样式根本改不了。
  // 改成 aria-label（读屏仍读得到）+ data-tip，交给自绘的羊皮纸提示框。
  parent.setAttribute("aria-label", text);
  parent.dataset.tip = text;
}

function appendSvg(parent, tagName, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, tagName);
  for (const [name, value] of Object.entries(attributes)) {
    if (name === "text") {
      element.textContent = value;
    } else if (value !== undefined && value !== null) {
      element.setAttribute(name, String(value));
    }
  }
  parent.append(element);
  return element;
}

const RESOURCE_GLYPHS = Object.freeze({
  wood: "r-wood",
  brick: "r-brick",
  sheep: "r-sheep",
  wheat: "r-wheat",
  ore: "r-ore",
});

const DICE_PIPS = {
  1: [[22, 22]],
  2: [[12, 12], [32, 32]],
  3: [[12, 12], [22, 22], [32, 32]],
  4: [[12, 12], [32, 12], [12, 32], [32, 32]],
  5: [[12, 12], [32, 12], [22, 22], [12, 32], [32, 32]],
  6: [[12, 12], [12, 22], [12, 32], [32, 12], [32, 22], [32, 32]],
};

let lastDiceKey = null;
let diceTumbleTimer = 0;
let diceRollPulse = false;

function resourceIcon(resource, className) {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", className || "res-icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", "#" + (RESOURCE_GLYPHS[resource] || "r-wood"));
  svg.append(use);
  return svg;
}

function appendResourceLabel(element, resource, text) {
  element.replaceChildren(
    resourceIcon(resource),
    document.createTextNode(" " + text),
  );
  return element;
}

function diceFace(value) {
  const face = document.createElementNS(SVG_NAMESPACE, "svg");
  face.setAttribute("viewBox", "0 0 44 44");
  face.setAttribute("class", "dice-face");
  face.setAttribute("aria-hidden", "true");
  for (const [cx, cy] of DICE_PIPS[value] || []) {
    const pip = document.createElementNS(SVG_NAMESPACE, "circle");
    pip.setAttribute("cx", cx);
    pip.setAttribute("cy", cy);
    pip.setAttribute("r", 4.2);
    face.append(pip);
  }
  return face;
}

function drawDice(die1, die2) {
  diceDisplayElement.replaceChildren();
  if (!die1 || !die2) {
    const idle = document.createElement("span");
    idle.className = "dice-idle";
    idle.textContent = "--";
    diceDisplayElement.append(idle);
    return;
  }
  diceDisplayElement.append(diceFace(die1), diceFace(die2));
}

/* 掷骰：骰子本身不动，只有点数在换。节奏由快转慢，像转盘停下来的那一下。
   最后落定在真实点数上；系统偏好减少动态效果时直接出结果。 */
function renderDice(dice) {
  const key = dice ? `${dice.die1}-${dice.die2}` : "none";
  if (key === lastDiceKey && !diceRollPulse) return;
  const animate = Boolean(dice) && (diceRollPulse || lastDiceKey !== "none");
  lastDiceKey = key;
  diceRollPulse = false;

  window.clearTimeout(diceTumbleTimer);

  if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    drawDice(dice ? dice.die1 : 0, dice ? dice.die2 : 0);
    return;
  }

  const steps = [80, 80, 90, 100, 120, 150, 190, 240];
  let step = 0;
  const spin = () => {
    if (step >= steps.length) {
      drawDice(dice.die1, dice.die2);
      return;
    }
    drawDice(
      1 + Math.floor(Math.random() * 6),
      1 + Math.floor(Math.random() * 6),
    );
    diceTumbleTimer = window.setTimeout(spin, steps[step]);
    step += 1;
  };
  spin();
}

/* 一条"月牙"路径：同一条轮廓，和它平移一份之后的轮廓首尾相接，
   交给 evenodd 求差，就得到沿某一侧的窄带 —— 这是内阴影，不用 filter。
   （这个 viewBox 只有 10 个单位宽，drop-shadow 的偏移会被当成用户单位，
   整块棋盘会炸，文件里棋盘那段注释记着。） */
function hexReliefPath(board, hex, dx, dz) {
  const shift = (vertex, ox, oz) =>
    `${(vertex.x + ox).toFixed(3)},${(vertex.z + oz).toFixed(3)}`;
  const outer = hex.vertexIds.map((id) => shift(board.vertices[id], 0, 0));
  const inner = hex.vertexIds.map((id) => shift(board.vertices[id], dx, dz));
  return `M${outer.join("L")}Z M${inner.join("L")}Z`;
}

/* 六边形的顶点串：地块、收成高光、投影三处都用它，别各写一份 */
function hexPolygonPoints(board, hex) {
  return hex.vertexIds
    .map((vertexId) => {
      const vertex = board.vertices[vertexId];
      return `${vertex.x},${vertex.z}`;
    })
    .join(" ");
}

function getBoardBounds(board) {
  const xs = board.vertices.map((vertex) => vertex.x);
  const zs = board.vertices.map((vertex) => vertex.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    minX,
    minZ,
    width: maxX - minX,
    height: maxZ - minZ,
  };
}

/* ---------- 首页带过来的启动参数 ----------
   home.html 的两个入口分别给 ?mode=solo 与 ?mode=online。
   有 mode 时，顶栏的新建对局区和房间页签按模式收起来（设置已经在首页给过了）；
   没有 mode 时保持原样，直接开 debug 页也还能用。 */
const launchParams = new URLSearchParams(window.location.search);
const launchMode = launchParams.get("mode");

function applyLaunchMode() {
  if (launchMode === "solo") {
    const name = launchParams.get("name");
    const bots = launchParams.get("bots");
    const difficulty = launchParams.get("difficulty");
    if (name) playerNameInput.value = name;
    if (bots) botCountSelect.value = bots;
    if (difficulty) botDifficultySelect.value = difficulty;
    startNewGame();
    return;
  }
  if (launchMode === "online") {
    const roomTab = sidebarTabButtons.find(
      (button) => button.dataset.sidebarTab === "room",
    );
    if (roomTab) roomTab.click();
  }
}

if (launchMode === "solo" || launchMode === "online") {
  document.body.dataset.launchMode = launchMode;
  window.setTimeout(applyLaunchMode, 0);
}

/* ---------- 大卡详版 ----------
   悬停或聚焦手牌时弹出一张大卡：卡面是那张插画，下面是牌名与规则。
   图片用 CSS 背景铺，缺文件时只是空着，不会出现裂图图标。
   资源卡没有别的动作，点一下可以把大卡钉住；发展卡的点击已经是"打出"，所以只做悬停。 */
const CARD_DETAIL_TEXT = {
  "resource:wood": ["木材", "产自森林地块。建造道路、定居点与城市都要用它。"],
  "resource:brick": ["砖块", "产自丘陵地块。与木材一起构成道路和定居点。"],
  "resource:sheep": ["羊毛", "产自牧场地块。建造定居点与购买发展卡都要用它。"],
  "resource:wheat": ["小麦", "产自农田地块。建造定居点、城市与购买发展卡都要用它。"],
  "resource:ore": ["矿石", "产自山地块。建造城市与购买发展卡都要用它。"],
  "dev:knight": ["骑士", "移动强盗并从相邻玩家偷取一张资源，打出后计入军队数量。"],
  "dev:victoryPoint": ["胜利点", "直接计入 1 点胜利分，不需要打出。"],
  "dev:roadBuilding": ["道路建设", "立刻免费放置两条道路。"],
  "dev:yearOfPlenty": ["丰收之年", "从银行任选两种资源各拿一张。"],
  "dev:monopoly": ["垄断", "指定一种资源，其他所有玩家把手中该资源全部交给你。"],
};

let cardDetailElement = null;
let cardDetailTimer = 0;
let cardDetailKey = null;
let cardDetailPinned = false;

function ensureCardDetail() {
  if (cardDetailElement) return cardDetailElement;
  const wrap = document.createElement("div");
  wrap.id = "card-detail";
  wrap.className = "card-detail hidden";
  wrap.innerHTML =
    '<figure class="card-lg">' +
    '<div class="card-lg-window"></div>' +
    '<h2 class="card-lg-name"></h2>' +
    '<span class="card-rule"></span>' +
    '<p class="card-lg-text"></p>' +
    "</figure>";
  wrap.addEventListener("pointerenter", () => window.clearTimeout(cardDetailTimer));
  wrap.addEventListener("pointerleave", () => scheduleCardDetailHide());
  document.body.append(wrap);
  cardDetailElement = wrap;
  return wrap;
}

function showCardDetail(key) {
  const entry = CARD_DETAIL_TEXT[key];
  if (!entry) return;
  const wrap = ensureCardDetail();
  if (cardDetailKey !== key) cardDetailPinned = false;
  cardDetailKey = key;
  wrap.querySelector(".card-lg-name").textContent = entry[0];
  wrap.querySelector(".card-lg-text").textContent = entry[1];
  wrap.querySelector(".card-lg-window").style.backgroundImage =
    `url("./assets/${key.split(":")[1]}-illus.webp?v=2")`;
  wrap.classList.remove("hidden");
  window.clearTimeout(cardDetailTimer);
}

function scheduleCardDetailHide() {
  if (cardDetailPinned) return;
  window.clearTimeout(cardDetailTimer);
  cardDetailTimer = window.setTimeout(() => {
    if (cardDetailElement) cardDetailElement.classList.add("hidden");
  }, 140);
}

function hideCardDetail(force) {
  if (cardDetailPinned && !force) return;
  window.clearTimeout(cardDetailTimer);
  if (cardDetailElement) cardDetailElement.classList.add("hidden");
}

function attachCardDetail(element) {
  const key = element.dataset.card;
  if (!key) return;
  element.addEventListener("pointerenter", () => showCardDetail(key));
  element.addEventListener("pointerleave", scheduleCardDetailHide);
  element.addEventListener("focus", () => showCardDetail(key));
  element.addEventListener("blur", () => hideCardDetail(false));
  if (key.startsWith("resource:")) {
    element.addEventListener("click", () => {
      cardDetailPinned = !cardDetailPinned;
      if (cardDetailPinned) showCardDetail(key);
      else hideCardDetail(true);
    });
  }
}

/* ---------- 落子三态与预览 ----------
   候选点统一画成“插座”：一层暖色底 + 一圈细墨线虚环 + 中心圆点，类型只靠颜色区分。
   指针停在哪个候选点，就把“放下去会是什么样”在 preview-layer 里先画一遍；
   点过一次的候选点留在原地钉住（.pinned），等确认牌。
   命中圈单独一个透明圆：环只有描边，太细了不好点。 */
function appendPlacementMarker(parent, className, x, z, tip, radius) {
  const marker = appendSvg(parent, "g", {
    class: `placement-marker ${className}`,
    transform: `translate(${x.toFixed(3)} ${z.toFixed(3)})`,
  });
  appendSvgTitle(marker, tip);
  appendSvg(marker, "circle", { r: radius, class: "marker-base" });
  appendSvg(marker, "circle", { r: (radius + 0.06).toFixed(3), class: "marker-hit" });
  return marker;
}

/* 幽灵件：用棋盘那套建筑渲染原样画一遍，所以预览不会和成品跑偏。
   只有定居点和城市需要画；道路那条边本身就是预览，强盗没有形状可言。 */
function drawPlacementGhost(spec, strong) {
  if (!placementPreviewLayer) return;
  placementPreviewLayer.replaceChildren();
  if (!spec || (spec.kind !== "settlement" && spec.kind !== "city")) return;
  const ghost = appendSvg(placementPreviewLayer, "g", {
    class: strong ? "placement-ghost is-pinned" : "placement-ghost",
  });
  appendBuildingShape(
    ghost,
    { x: spec.x, z: spec.z, building: { type: spec.kind } },
    spec.player,
  );
}

function bindPlacementMarker(marker, spec, onPick) {
  marker.addEventListener("pointerenter", () => {
    /* 已经钉住另一个点时不去抢预览，不然玩家会以为选择被换掉了 */
    if (pinnedPlacementMarker && pinnedPlacementMarker !== marker) return;
    placementPreviewOwner = marker;
    drawPlacementGhost(spec, pinnedPlacementMarker === marker);
  });
  marker.addEventListener("pointerleave", () => {
    if (placementPreviewOwner !== marker) return;
    placementPreviewOwner = null;
    if (pinnedPlacementMarker === marker) return;
    drawPlacementGhost(null);
  });
  marker.addEventListener("click", () => {
    pinnedPlacementMarker = marker;
    marker.classList.add("pinned");
    drawPlacementGhost(spec, true);
    onPick();
  });
}

/* ---------- 落子二次确认 ----------
   点高亮位不再直接下单：先在原地弹一张确认牌，确认才执行，取消或按 Esc 放弃，
   点棋盘空白处也取消。确认牌是 HTML 浮层而不是画进棋盘，这样棋盘重画时它不会闪，
   按钮也能保持可读尺寸；位置用棋盘的 CTM 从棋盘坐标换算到屏幕坐标。 */
function openPlacementConfirm(command, x, z, label) {
  if (!placementConfirmElement) return;
  const caption = placementConfirmElement.querySelector("p");
  if (caption) caption.textContent = label;

  let left = window.innerWidth / 2;
  let top = window.innerHeight / 2;
  const matrix = typeof boardElement.getScreenCTM === "function" ? boardElement.getScreenCTM() : null;
  if (matrix) {
    const point = boardElement.createSVGPoint();
    point.x = x;
    point.y = z;
    const screen = point.matrixTransform(matrix);
    left = Math.min(Math.max(screen.x, 96), window.innerWidth - 96);
    /* 上边界留出工具栏的高度，靠边界的交点也不会被确认牌盖住 */
    top = Math.max(screen.y - 14, 118);
  }
  placementConfirmElement.style.left = `${Math.round(left)}px`;
  placementConfirmElement.style.top = `${Math.round(top)}px`;
  placementConfirmElement.classList.remove("hidden");
  pendingPlacement = { command };
}

function closePlacementConfirm() {
  pendingPlacement = null;
  if (pinnedPlacementMarker) {
    pinnedPlacementMarker.classList.remove("pinned");
    pinnedPlacementMarker = null;
  }
  placementPreviewOwner = null;
  drawPlacementGhost(null);
  if (placementConfirmElement) placementConfirmElement.classList.add("hidden");
}

function confirmPlacement() {
  const pending = pendingPlacement;
  closePlacementConfirm();
  if (pending) dispatchHuman(pending.command);
}

if (placementConfirmElement) {
  const yes = placementConfirmElement.querySelector(".confirm-yes");
  const no = placementConfirmElement.querySelector(".confirm-no");
  if (yes) yes.addEventListener("click", confirmPlacement);
  if (no) no.addEventListener("click", closePlacementConfirm);
  boardCanvasElement.addEventListener("click", (event) => {
    const target = event.target;
    if (
      target &&
      typeof target.closest === "function" &&
      target.closest(".valid-target, .valid-road-target, .robber-target")
    ) {
      return;
    }
    closePlacementConfirm();
  });
  /* 缩放或平移后棋盘坐标到屏幕坐标的换算就变了，先收起，避免确认牌停在旧位置 */
  boardCanvasElement.addEventListener("wheel", closePlacementConfirm, { passive: true });
  boardCanvasElement.addEventListener("dblclick", closePlacementConfirm);
}


},
"src/bots/heuristic-bot.js": function(module, exports, __require) {
const { BUILD_COSTS: BUILD_COSTS, COMMAND_TYPES: COMMAND_TYPES, DEVELOPMENT_CARD_TYPES: DEVELOPMENT_CARD_TYPES, EVENT_TYPES: EVENT_TYPES, PIECE_LIMITS: PIECE_LIMITS, RESOURCES: RESOURCES } = __require("src/core/constants.js");
const { legalBuildCityVertices: legalBuildCityVertices, legalBuildRoadEdges: legalBuildRoadEdges, legalBuildSettlementVertices: legalBuildSettlementVertices } = __require("src/core/board.js");
const { chooseRandomCommand: chooseRandomCommand } = __require("src/bots/random-bot.js");

const AI_DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);

const PIP_WEIGHTS = Object.freeze({
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
});

const DIFFICULTY_PROFILES = Object.freeze({
  easy: {
    randomChance: 0.55,
    jitter: 18,
    opponentWeight: 0.5,
  },
  medium: {
    randomChance: 0.12,
    jitter: 8,
    opponentWeight: 0.8,
  },
  hard: {
    randomChance: 0,
    jitter: 0,
    opponentWeight: 1.35,
  },
});

const TRADE_COOLDOWNS = Object.freeze({
  sameQuoteTurns: 3,
  consecutiveRejections: 2,
  targetTurns: 2,
});

function chooseBotCommand (
  view,
  difficulty = "medium",
  random = Math.random,
) {
  if (!view?.validCommands?.length) return null;

  const profile = DIFFICULTY_PROFILES[difficulty] || DIFFICULTY_PROFILES.medium;
  if (view.phase === "AWAITING_DISCARD") {
    return chooseDiscardCommand(view, difficulty, random);
  }

  const commands = getBotCommands(view, difficulty);
  if (commands.length === 0) {
    const fallback = view.validCommands.find(
      (command) => command.type !== COMMAND_TYPES.CREATE_TRADE,
    );
    return fallback ? structuredClone(fallback) : null;
  }

  if (profile.randomChance > 0 && random() < profile.randomChance) {
    return chooseRandomCommand({ ...view, validCommands: commands }, random);
  }

  const scored = commands.map((command) => ({
    command,
    score:
      scoreCommand(view, command, difficulty, profile) +
      (profile.jitter > 0 ? (random() - 0.5) * profile.jitter : 0),
  }));
  scored.sort((first, second) => second.score - first.score);
  return structuredClone(scored[0].command);
}

function getBotCommands(view, difficulty) {
  const bankTradeCompletesBuild = view.validCommands.some(
    (command) =>
      command.type === COMMAND_TYPES.TRADE_WITH_BANK &&
      completesImmediateBuild(view, command),
  );

  return view.validCommands
    .map((command) =>
      prepareCommand(view, command, difficulty, bankTradeCompletesBuild),
    )
    .filter(Boolean);
}

function prepareCommand(
  view,
  command,
  difficulty,
  bankTradeCompletesBuild,
) {
  if (command.type !== COMMAND_TYPES.CREATE_TRADE) return command;
  if (difficulty === "easy") return null;
  if (hasProactiveTradeThisTurn(view)) return null;
  if (bankTradeCompletesBuild) return null;
  if (!completesImmediateBuild(view, command)) return null;
  if (isRecentlyRejectedTrade(view, command)) return null;

  const pairHistory = getTradePairRejectionHistory(view, command);
  if (pairHistory.rejections > TRADE_COOLDOWNS.consecutiveRejections - 1) {
    return null;
  }

  const targetPlayerIds = getTradeTargets(view, command).filter(
    (playerId) => !isTargetOnTradeCooldown(view, playerId),
  );
  if (targetPlayerIds.length === 0) return null;

  return {
    ...command,
    targetPlayerIds,
  };
}

function scoreCommand(view, command, difficulty, profile) {
  const me = getPlayer(view, view.viewerId);

  switch (command.type) {
    case COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT:
    case COMMAND_TYPES.BUILD_SETTLEMENT:
      return (
        34 +
        scoreVertex(view, command.vertexId, profile.opponentWeight) * 1.35 +
        (command.type === COMMAND_TYPES.BUILD_SETTLEMENT ? 24 : 0)
      );
    case COMMAND_TYPES.PLACE_INITIAL_ROAD:
    case COMMAND_TYPES.BUILD_ROAD:
    case COMMAND_TYPES.PLACE_FREE_ROAD:
      return (
        18 +
        scoreRoad(view, command.edgeId, profile.opponentWeight) +
        (command.type === COMMAND_TYPES.BUILD_ROAD ? 6 : 0) +
        (command.type === COMMAND_TYPES.PLACE_FREE_ROAD ? 14 : 0)
      );
    case COMMAND_TYPES.BUILD_CITY:
      return 72 + scoreVertex(view, command.vertexId, profile.opponentWeight) * 0.35;
    case COMMAND_TYPES.BUY_DEVELOPMENT_CARD:
      return 28 + (difficulty === "hard" ? 12 : 0);
    case COMMAND_TYPES.PLAY_KNIGHT:
      return 48 + (difficulty === "hard" ? 14 : 0);
    case COMMAND_TYPES.PLAY_ROAD_BUILDING:
      return 42;
    case COMMAND_TYPES.PLAY_YEAR_OF_PLENTY:
      return 38;
    case COMMAND_TYPES.PLAY_MONOPOLY:
      return 32 + estimateMonopolyGain(view, command.resource);
    case COMMAND_TYPES.REVEAL_VICTORY_POINT:
      return 60 + me.victoryPoints;
    case COMMAND_TYPES.CHOOSE_RESOURCE:
      return 30 + resourceNeedScore(view, command.resource);
    case COMMAND_TYPES.MOVE_ROBBER:
      return scoreRobberHex(view, command.hexId, profile.opponentWeight);
    case COMMAND_TYPES.CHOOSE_STEAL_TARGET:
      return scoreStealTarget(view, command.playerId, profile.opponentWeight);
    case COMMAND_TYPES.TRADE_WITH_BANK:
      return scoreBankTrade(view, command);
    case COMMAND_TYPES.RESPOND_TO_TRADE:
      return command.accepted ? scoreTradeAcceptance(view) : 8;
    case COMMAND_TYPES.CONFIRM_TRADE:
      return 26 + scoreTradeAcceptance(view);
    case COMMAND_TYPES.CANCEL_TRADE:
      return 4;
    case COMMAND_TYPES.CREATE_TRADE:
      return scorePlayerTradeOffer(view, command, difficulty);
    case COMMAND_TYPES.END_TURN:
      return 1;
    default:
      return 0;
  }
}

function chooseDiscardCommand(view, difficulty, random) {
  const player = getPlayer(view, view.viewerId);
  const required = view.validCommands.find(
    (command) => command.type === COMMAND_TYPES.DISCARD_RESOURCES,
  )?.required;
  if (!required || !player?.resources) return chooseRandomCommand(view, random);

  const selected = Object.fromEntries(RESOURCES.map((resource) => [resource, 0]));
  const candidates = RESOURCES.map((resource) => ({
    resource,
    value: resourceNeedScore(view, resource) + player.resources[resource] * 0.2,
  })).sort((first, second) => first.value - second.value);

  let remaining = required;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, player.resources[candidate.resource]);
    selected[candidate.resource] = amount;
    remaining -= amount;
  }

  if (remaining > 0 || (difficulty === "easy" && random() < 0.5)) {
    return chooseRandomCommand(view, random);
  }
  return {
    type: COMMAND_TYPES.DISCARD_RESOURCES,
    resources: selected,
  };
}

function scoreVertex(view, vertexId, opponentWeight) {
  const vertex = view.board.vertices[vertexId];
  if (!vertex) return 0;

  const resources = new Set();
  let score = 0;
  for (const hexId of vertex.hexIds) {
    const hex = view.board.hexes[hexId];
    if (!hex.resource || hex.id === view.robberHexId) continue;
    resources.add(hex.resource);
    score += PIP_WEIGHTS[hex.number] || 0;
  }

  score += resources.size * 4;
  if (vertex.harbor === "any") score += 4;
  if (vertex.harbor && vertex.harbor !== "any") score += 2.5;

  for (const adjacentId of vertex.adjacentVertexIds) {
    const building = view.board.vertices[adjacentId]?.building;
    if (!building) continue;
    if (building.playerId === view.viewerId) score -= 6;
    else score -= 2 * opponentWeight;
  }
  return score;
}

function scoreRoad(view, edgeId, opponentWeight) {
  const edge = view.board.edges[edgeId];
  if (!edge) return 0;

  const endpointScores = [edge.v1, edge.v2]
    .map((vertexId) => scoreVertex(view, vertexId, opponentWeight))
    .sort((first, second) => second - first);
  const production = edge.hexIds.reduce((total, hexId) => {
    const hex = view.board.hexes[hexId];
    return total + (PIP_WEIGHTS[hex.number] || 0) * 0.7;
  }, 0);
  return production + endpointScores[0] * 0.42 + endpointScores[1] * 0.16;
}

function scoreRobberHex(view, hexId, opponentWeight) {
  const hex = view.board.hexes[hexId];
  if (!hex) return 0;
  let score = (PIP_WEIGHTS[hex.number] || 0) * 3;

  for (const vertexId of hex.vertexIds) {
    const building = view.board.vertices[vertexId]?.building;
    if (!building) continue;
    const owner = getPlayer(view, building.playerId);
    if (building.playerId === view.viewerId) {
      score -= building.type === "city" ? 15 : 9;
    } else {
      score += (building.type === "city" ? 10 : 6) * opponentWeight;
      score += Math.max(0, owner.victoryPoints - getPlayer(view, view.viewerId).victoryPoints) * 2;
    }
  }
  return score;
}

function scoreStealTarget(view, playerId, opponentWeight) {
  const target = getPlayer(view, playerId);
  if (!target) return 0;
  return (
    target.resourceCount * 2.5 +
    target.victoryPoints * 2 +
    Math.max(0, target.victoryPoints - getPlayer(view, view.viewerId).victoryPoints) *
      opponentWeight
  );
}

function scoreBankTrade(view, command) {
  const receiveValue = resourceNeedScore(view, command.receiveResource);
  const giveValue = resourceNeedScore(view, command.giveResource);
  const receivedAmount = Number(command.receiveAmount || 1);
  const givenAmount = Number(command.giveAmount || 1);
  return (receiveValue - giveValue) * receivedAmount - givenAmount * 0.8;
}

function scoreTradeAcceptance(view) {
  const trade = view.trade;
  if (!trade) return 0;

  const receiveValue = Object.entries(trade.offer).reduce(
    (total, [resource, amount]) =>
      total + resourceNeedScore(view, resource) * Number(amount || 0),
    0,
  );
  const giveValue = Object.entries(trade.request).reduce(
    (total, [resource, amount]) =>
      total + resourceNeedScore(view, resource) * Number(amount || 0),
    0,
  );
  return receiveValue - giveValue;
}

function scorePlayerTradeOffer(view, command, difficulty) {
  if (difficulty === "easy") return -12;

  const offerResource = Object.entries(command.offer).find(([, amount]) => amount > 0)?.[0];
  const requestResource = Object.entries(command.request).find(([, amount]) => amount > 0)?.[0];
  if (!offerResource || !requestResource) return -20;

  if (isRecentlyRejectedTrade(view, command)) return -100;

  const offerAmount = Number(command.offer[offerResource] || 0);
  const requestAmount = Number(command.request[requestResource] || 0);
  const value =
    resourceNeedScore(view, requestResource) * requestAmount -
    resourceNeedScore(view, offerResource) * offerAmount;
  if (value <= 0) return -8;

  if (difficulty === "hard") return 18 + value * 1.4;
  return 8 + value;
}

function hasProactiveTradeThisTurn(view) {
  const events = view.eventLog || [];
  const turnStart = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === EVENT_TYPES.TURN_STARTED &&
        event.payload?.playerId === view.viewerId,
    );
  if (!turnStart) return false;

  return events.some(
    (event) =>
      event.sequence > turnStart.sequence &&
      event.type === EVENT_TYPES.TRADE_CREATED &&
      event.payload?.fromPlayerId === view.viewerId,
  );
}

function completesImmediateBuild(view, command) {
  const player = getPlayer(view, view.viewerId);
  if (!player?.resources || !view.board) return false;

  const resourcesAfterTrade = getResourcesAfterTrade(player.resources, command);
  if (!resourcesAfterTrade) return false;

  const buildOptions = [
    {
      cost: BUILD_COSTS.road,
      placed: player.roads?.length || 0,
      limit: PIECE_LIMITS.road,
      legal: legalBuildRoadEdges(view.board, player.id).length > 0,
    },
    {
      cost: BUILD_COSTS.settlement,
      placed: player.settlements?.length || 0,
      limit: PIECE_LIMITS.settlement,
      legal: legalBuildSettlementVertices(view.board, player.id).length > 0,
    },
    {
      cost: BUILD_COSTS.city,
      placed: player.cities?.length || 0,
      limit: PIECE_LIMITS.city,
      legal: legalBuildCityVertices(view.board, player.id).length > 0,
    },
  ];

  return buildOptions.some(
    (option) =>
      option.placed < option.limit &&
      option.legal &&
      !canAffordResources(player.resources, option.cost) &&
      canAffordResources(resourcesAfterTrade, option.cost),
  );
}

function getResourcesAfterTrade(resources, command) {
  const next = { ...resources };

  if (command.type === COMMAND_TYPES.TRADE_WITH_BANK) {
    next[command.giveResource] -= Number(command.giveAmount || 0);
    next[command.receiveResource] += Number(command.receiveAmount || 0);
  } else if (command.type === COMMAND_TYPES.CREATE_TRADE) {
    for (const resource of RESOURCES) {
      next[resource] -= Number(command.offer?.[resource] || 0);
      next[resource] += Number(command.request?.[resource] || 0);
    }
  } else {
    return null;
  }

  return RESOURCES.every((resource) => next[resource] >= 0) ? next : null;
}

function canAffordResources(resources, cost) {
  return Object.entries(cost).every(
    ([resource, amount]) => Number(resources[resource] || 0) >= amount,
  );
}

function getTradeTargets(view, command) {
  const requested = Array.isArray(command.targetPlayerIds)
    ? command.targetPlayerIds
    : view.players
        .filter((player) => player.id !== view.viewerId)
        .map((player) => player.id);
  return [...new Set(requested.map(Number))].filter(
    (playerId) =>
      Number.isInteger(playerId) &&
      playerId !== view.viewerId &&
      view.players.some((player) => player.id === playerId),
  );
}

function isTargetOnTradeCooldown(view, targetPlayerId) {
  const cancellations = getViewerTradeCancellations(view);
  let consecutiveRejections = 0;
  let latestRejection = null;

  for (let index = cancellations.length - 1; index >= 0; index -= 1) {
    const event = cancellations[index];
    if (!wasTargetRejected(event.payload, targetPlayerId)) break;
    consecutiveRejections += 1;
    latestRejection ||= event;
    if (consecutiveRejections >= TRADE_COOLDOWNS.consecutiveRejections) break;
  }

  if (consecutiveRejections < TRADE_COOLDOWNS.consecutiveRejections) return false;
  return (
    countTurnStartsAfter(view, latestRejection.sequence) <
    TRADE_COOLDOWNS.targetTurns
  );
}

function getViewerTradeCancellations(view) {
  return (view.eventLog || []).filter(
    (event) =>
      event.type === EVENT_TYPES.TRADE_CANCELLED &&
      event.payload?.playerId === view.viewerId,
  );
}

function wasTargetRejected(payload, targetPlayerId) {
  const targeted = (payload?.targetPlayerIds || []).includes(targetPlayerId);
  if (!targeted) return false;
  const response =
    payload?.responses?.[targetPlayerId] ??
    payload?.responses?.[String(targetPlayerId)];
  return response === "REJECTED";
}

function getTradePairRejectionHistory(view, command) {
  const commandPair = tradePairKey(command.offer, command.request);
  let rejections = 0;

  for (const event of [...(view.eventLog || [])].reverse()) {
    const payload = event.payload || {};
    if (
      (event.type !== EVENT_TYPES.TRADE_CANCELLED &&
        event.type !== EVENT_TYPES.TRADE_COMPLETED) ||
      tradePairKey(payload.offer, payload.request) !== commandPair
    ) {
      continue;
    }

    if (
      event.type === EVENT_TYPES.TRADE_COMPLETED &&
      payload.participants?.includes(view.viewerId)
    ) {
      break;
    }
    if (
      event.type === EVENT_TYPES.TRADE_CANCELLED &&
      payload.playerId === view.viewerId
    ) {
      rejections += 1;
    }
  }

  return { rejections };
}

function isRecentlyRejectedTrade(view, command) {
  const commandKey = tradeKey(command.offer, command.request);
  const cancelled = [...(view.eventLog || [])]
    .reverse()
    .find(
      (event) =>
        event.type === EVENT_TYPES.TRADE_CANCELLED &&
        event.payload?.playerId === view.viewerId &&
        tradeKey(event.payload?.offer, event.payload?.request) === commandKey,
    );
  if (!cancelled) return false;

  return (
    countTurnStartsAfter(view, cancelled.sequence) <
    TRADE_COOLDOWNS.sameQuoteTurns
  );
}

function countTurnStartsAfter(view, sequence) {
  return (view.eventLog || []).filter(
    (event) =>
      event.sequence > sequence &&
      event.type === EVENT_TYPES.TURN_STARTED,
  ).length;
}

function tradeKey(offer = {}, request = {}) {
  const poolKey = (pool) =>
    RESOURCES.filter((resource) => Number(pool[resource] || 0) > 0)
      .map((resource) => `${resource}:${Number(pool[resource])}`)
      .join(",");
  return `${poolKey(offer)}->${poolKey(request)}`;
}

function tradePairKey(offer = {}, request = {}) {
  const poolKey = (pool) =>
    RESOURCES.filter((resource) => Number(pool[resource] || 0) > 0).join(",");
  return `${poolKey(offer)}->${poolKey(request)}`;
}

function resourceNeedScore(view, resource) {
  const player = getPlayer(view, view.viewerId);
  if (!player?.resources) return 0;

  const goals = [
    { cost: BUILD_COSTS.road, priority: 0.8 },
    { cost: BUILD_COSTS.settlement, priority: 1.15 },
    { cost: BUILD_COSTS.city, priority: 1.35 },
    { cost: { sheep: 1, wheat: 1, ore: 1 }, priority: 0.9 },
  ];

  let score = 0;
  for (const goal of goals) {
    const before = missingCount(player.resources, goal.cost);
    const simulated = {
      ...player.resources,
      [resource]: player.resources[resource] + 1,
    };
    const after = missingCount(simulated, goal.cost);
    score += (before - after) * goal.priority;
    if (after === 0 && before > 0) score += 6 * goal.priority;
  }
  return score + Math.max(0, 4 - player.resources[resource]);
}

function missingCount(resources, cost) {
  return Object.entries(cost).reduce(
    (total, [resource, amount]) => total + Math.max(0, amount - resources[resource]),
    0,
  );
}

function estimateMonopolyGain(view, resource) {
  const totalOpponentCards = view.players
    .filter((player) => player.id !== view.viewerId)
    .reduce((total, player) => total + player.resourceCount, 0);
  return Math.min(18, totalOpponentCards * 0.35) + resourceNeedScore(view, resource);
}

function getPlayer(view, playerId) {
  return view.players.find((player) => player.id === playerId);
}

exports["AI_DIFFICULTIES"] = AI_DIFFICULTIES;
exports["chooseBotCommand"] = chooseBotCommand;
},
"src/core/constants.js": function(module, exports, __require) {
const GAME_PHASES = Object.freeze({
  LOBBY: "LOBBY",
  SETUP_ROUND_1: "SETUP_ROUND_1",
  SETUP_ROUND_2: "SETUP_ROUND_2",
  AWAITING_ROLL: "AWAITING_ROLL",
  TURN_ACTIONS: "TURN_ACTIONS",
  AWAITING_DISCARD: "AWAITING_DISCARD",
  AWAITING_ROBBER_MOVE: "AWAITING_ROBBER_MOVE",
  AWAITING_STEAL_TARGET: "AWAITING_STEAL_TARGET",
  AWAITING_FREE_ROAD: "AWAITING_FREE_ROAD",
  AWAITING_RESOURCE_CHOICE: "AWAITING_RESOURCE_CHOICE",
  GAME_OVER: "GAME_OVER",
});

const SETUP_STEPS = Object.freeze({
  SETTLEMENT: "settlement",
  ROAD: "road",
});

const COMMAND_TYPES = Object.freeze({
  START_GAME: "START_GAME",
  PLACE_INITIAL_SETTLEMENT: "PLACE_INITIAL_SETTLEMENT",
  PLACE_INITIAL_ROAD: "PLACE_INITIAL_ROAD",
  ROLL_DICE: "ROLL_DICE",
  END_TURN: "END_TURN",
  BUILD_ROAD: "BUILD_ROAD",
  BUILD_SETTLEMENT: "BUILD_SETTLEMENT",
  BUILD_CITY: "BUILD_CITY",
  DISCARD_RESOURCES: "DISCARD_RESOURCES",
  MOVE_ROBBER: "MOVE_ROBBER",
  CHOOSE_STEAL_TARGET: "CHOOSE_STEAL_TARGET",
  BUY_DEVELOPMENT_CARD: "BUY_DEVELOPMENT_CARD",
  PLAY_KNIGHT: "PLAY_KNIGHT",
  PLAY_ROAD_BUILDING: "PLAY_ROAD_BUILDING",
  PLAY_YEAR_OF_PLENTY: "PLAY_YEAR_OF_PLENTY",
  PLAY_MONOPOLY: "PLAY_MONOPOLY",
  PLACE_FREE_ROAD: "PLACE_FREE_ROAD",
  CHOOSE_RESOURCE: "CHOOSE_RESOURCE",
  REVEAL_VICTORY_POINT: "REVEAL_VICTORY_POINT",
  TRADE_WITH_BANK: "TRADE_WITH_BANK",
  CREATE_TRADE: "CREATE_TRADE",
  RESPOND_TO_TRADE: "RESPOND_TO_TRADE",
  CONFIRM_TRADE: "CONFIRM_TRADE",
  CANCEL_TRADE: "CANCEL_TRADE",
});

const EVENT_TYPES = Object.freeze({
  GAME_STARTED: "GAME_STARTED",
  BOARD_CREATED: "BOARD_CREATED",
  PHASE_CHANGED: "PHASE_CHANGED",
  TURN_STARTED: "TURN_STARTED",
  SETTLEMENT_PLACED: "SETTLEMENT_PLACED",
  ROAD_PLACED: "ROAD_PLACED",
  RESOURCES_GAINED: "RESOURCES_GAINED",
  SETUP_COMPLETED: "SETUP_COMPLETED",
  DICE_ROLLED: "DICE_ROLLED",
  RESOURCES_PRODUCED: "RESOURCES_PRODUCED",
  BANK_RESOURCE_SHORTAGE: "BANK_RESOURCE_SHORTAGE",
  HAND_CHANGED: "HAND_CHANGED",
  TURN_ENDED: "TURN_ENDED",
  RESOURCES_SPENT: "RESOURCES_SPENT",
  CITY_PLACED: "CITY_PLACED",
  VICTORY_POINTS_CHANGED: "VICTORY_POINTS_CHANGED",
  GAME_ENDED: "GAME_ENDED",
  DISCARD_REQUIRED: "DISCARD_REQUIRED",
  RESOURCES_DISCARDED: "RESOURCES_DISCARDED",
  DISCARD_COUNT_CHANGED: "DISCARD_COUNT_CHANGED",
  ROBBER_MOVED: "ROBBER_MOVED",
  RESOURCE_LOST: "RESOURCE_LOST",
  RESOURCE_STOLEN: "RESOURCE_STOLEN",
  STEAL_RESOLVED: "STEAL_RESOLVED",
  DEVELOPMENT_CARD_PURCHASED: "DEVELOPMENT_CARD_PURCHASED",
  DEVELOPMENT_CARD_DRAWN: "DEVELOPMENT_CARD_DRAWN",
  DEVELOPMENT_CARD_PLAYED: "DEVELOPMENT_CARD_PLAYED",
  ROAD_BUILDING_STARTED: "ROAD_BUILDING_STARTED",
  FREE_ROAD_PLACED: "FREE_ROAD_PLACED",
  YEAR_OF_PLENTY_STARTED: "YEAR_OF_PLENTY_STARTED",
  MONOPOLY_RESOLVED: "MONOPOLY_RESOLVED",
  VICTORY_POINT_REVEALED: "VICTORY_POINT_REVEALED",
  LONGEST_ROAD_CHANGED: "LONGEST_ROAD_CHANGED",
  LARGEST_ARMY_CHANGED: "LARGEST_ARMY_CHANGED",
  BANK_TRADE_COMPLETED: "BANK_TRADE_COMPLETED",
  TRADE_CREATED: "TRADE_CREATED",
  TRADE_RESPONSE_RECORDED: "TRADE_RESPONSE_RECORDED",
  TRADE_ROUND_COMPLETED: "TRADE_ROUND_COMPLETED",
  TRADE_COMPLETED: "TRADE_COMPLETED",
  TRADE_CANCELLED: "TRADE_CANCELLED",
});

const ERROR_CODES = Object.freeze({
  GAME_NOT_FOUND: "GAME_NOT_FOUND",
  GAME_ALREADY_STARTED: "GAME_ALREADY_STARTED",
  INVALID_PLAYER_COUNT: "INVALID_PLAYER_COUNT",
  PLAYER_NOT_FOUND: "PLAYER_NOT_FOUND",
  NOT_YOUR_TURN: "NOT_YOUR_TURN",
  INVALID_PHASE: "INVALID_PHASE",
  INVALID_SETUP_STEP: "INVALID_SETUP_STEP",
  INVALID_VERTEX: "INVALID_VERTEX",
  INVALID_EDGE: "INVALID_EDGE",
  OCCUPIED_VERTEX: "OCCUPIED_VERTEX",
  OCCUPIED_EDGE: "OCCUPIED_EDGE",
  DISTANCE_RULE_VIOLATION: "DISTANCE_RULE_VIOLATION",
  ROAD_NOT_CONNECTED: "ROAD_NOT_CONNECTED",
  INSUFFICIENT_RESOURCES: "INSUFFICIENT_RESOURCES",
  RESOURCE_LIMIT_REACHED: "RESOURCE_LIMIT_REACHED",
  INVALID_BUILDING: "INVALID_BUILDING",
  DISCARD_NOT_REQUIRED: "DISCARD_NOT_REQUIRED",
  DISCARD_COUNT_MISMATCH: "DISCARD_COUNT_MISMATCH",
  INVALID_HEX: "INVALID_HEX",
  ROBBER_SAME_HEX: "ROBBER_SAME_HEX",
  INVALID_STEAL_TARGET: "INVALID_STEAL_TARGET",
  CARD_NOT_OWNED: "CARD_NOT_OWNED",
  CARD_NOT_PLAYABLE: "CARD_NOT_PLAYABLE",
  CARD_BOUGHT_THIS_TURN: "CARD_BOUGHT_THIS_TURN",
  ONE_DEV_CARD_PER_TURN: "ONE_DEV_CARD_PER_TURN",
  DEVELOPMENT_DECK_EMPTY: "DEVELOPMENT_DECK_EMPTY",
  INVALID_RESOURCE: "INVALID_RESOURCE",
  FREE_ROAD_NOT_AVAILABLE: "FREE_ROAD_NOT_AVAILABLE",
  INVALID_TRADE: "INVALID_TRADE",
  INVALID_TRADE_RATIO: "INVALID_TRADE_RATIO",
  TRADE_ALREADY_OPEN: "TRADE_ALREADY_OPEN",
  TRADE_NOT_FOUND: "TRADE_NOT_FOUND",
  NOT_TRADE_TARGET: "NOT_TRADE_TARGET",
  TRADE_TARGET_NOT_ACCEPTED: "TRADE_TARGET_NOT_ACCEPTED",
  TRADE_ALREADY_RESPONDED: "TRADE_ALREADY_RESPONDED",
  TRADE_WAITING_FOR_RESPONSES: "TRADE_WAITING_FOR_RESPONSES",
  VERSION_CONFLICT: "VERSION_CONFLICT",
  ALREADY_ROLLED: "ALREADY_ROLLED",
  UNKNOWN_COMMAND: "UNKNOWN_COMMAND",
});

const RESOURCES = Object.freeze(["wood", "brick", "sheep", "wheat", "ore"]);

const RESOURCE_LABELS = Object.freeze({
  wood: "木材",
  brick: "砖块",
  sheep: "羊毛",
  wheat: "小麦",
  ore: "矿石",
});

const RESOURCE_ICONS = Object.freeze({
  wood: "🌲",
  brick: "🧱",
  sheep: "🐑",
  wheat: "🌾",
  ore: "⛰️",
});

const TERRAIN_TO_RESOURCE = Object.freeze({
  forest: "wood",
  hills: "brick",
  pasture: "sheep",
  fields: "wheat",
  mountains: "ore",
  desert: null,
});

const PLAYER_COLORS = Object.freeze([
  /* 莫兰迪玩家身份色：封蜡红、靛青、赭褐、橄榄，都能压在纸色与地块上 */
  "#a3453b",
  "#45607a",
  "#7a5b33",
  "#5e6a3a",
]);

const DEFAULT_PLAYER_NAMES = Object.freeze([
  "你",
  "Ada",
  "Bjorn",
  "Cleo",
]);

const BANK_PER_RESOURCE = 19;
const VICTORY_POINTS_TO_WIN = 10;
const STARTING_RESOURCES_PER_TYPE = 1;

const BUILD_COSTS = Object.freeze({
  road: Object.freeze({ wood: 1, brick: 1 }),
  settlement: Object.freeze({ wood: 1, brick: 1, sheep: 1, wheat: 1 }),
  city: Object.freeze({ ore: 3, wheat: 2 }),
});

const PIECE_LIMITS = Object.freeze({
  road: 15,
  settlement: 5,
  city: 4,
});

const DEVELOPMENT_CARD_TYPES = Object.freeze({
  KNIGHT: "knight",
  VICTORY_POINT: "victoryPoint",
  ROAD_BUILDING: "roadBuilding",
  YEAR_OF_PLENTY: "yearOfPlenty",
  MONOPOLY: "monopoly",
});

const DEVELOPMENT_CARD_COUNTS = Object.freeze({
  [DEVELOPMENT_CARD_TYPES.KNIGHT]: 14,
  [DEVELOPMENT_CARD_TYPES.VICTORY_POINT]: 5,
  [DEVELOPMENT_CARD_TYPES.ROAD_BUILDING]: 2,
  [DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY]: 2,
  [DEVELOPMENT_CARD_TYPES.MONOPOLY]: 2,
});

const DEVELOPMENT_CARD_COST = Object.freeze({
  sheep: 1,
  wheat: 1,
  ore: 1,
});

exports["GAME_PHASES"] = GAME_PHASES;
exports["SETUP_STEPS"] = SETUP_STEPS;
exports["COMMAND_TYPES"] = COMMAND_TYPES;
exports["EVENT_TYPES"] = EVENT_TYPES;
exports["ERROR_CODES"] = ERROR_CODES;
exports["RESOURCES"] = RESOURCES;
exports["RESOURCE_LABELS"] = RESOURCE_LABELS;
exports["RESOURCE_ICONS"] = RESOURCE_ICONS;
exports["TERRAIN_TO_RESOURCE"] = TERRAIN_TO_RESOURCE;
exports["PLAYER_COLORS"] = PLAYER_COLORS;
exports["DEFAULT_PLAYER_NAMES"] = DEFAULT_PLAYER_NAMES;
exports["BANK_PER_RESOURCE"] = BANK_PER_RESOURCE;
exports["VICTORY_POINTS_TO_WIN"] = VICTORY_POINTS_TO_WIN;
exports["STARTING_RESOURCES_PER_TYPE"] = STARTING_RESOURCES_PER_TYPE;
exports["BUILD_COSTS"] = BUILD_COSTS;
exports["PIECE_LIMITS"] = PIECE_LIMITS;
exports["DEVELOPMENT_CARD_TYPES"] = DEVELOPMENT_CARD_TYPES;
exports["DEVELOPMENT_CARD_COUNTS"] = DEVELOPMENT_CARD_COUNTS;
exports["DEVELOPMENT_CARD_COST"] = DEVELOPMENT_CARD_COST;
},
"src/core/board.js": function(module, exports, __require) {
const { RESOURCES: RESOURCES, TERRAIN_TO_RESOURCE: TERRAIN_TO_RESOURCE } = __require("src/core/constants.js");
const { shuffle: shuffle } = __require("src/core/rng.js");

const HEX_SIZE = 1;

const TERRAIN_POOL = [
  "forest",
  "forest",
  "forest",
  "forest",
  "pasture",
  "pasture",
  "pasture",
  "pasture",
  "fields",
  "fields",
  "fields",
  "fields",
  "hills",
  "hills",
  "hills",
  "mountains",
  "mountains",
  "mountains",
  "desert",
];

const NUMBER_POOL = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const HARBOR_POOL = ["any", "any", "any", "any", "wood", "brick", "sheep", "wheat", "ore"];

function axialToWorld(q, r, size = HEX_SIZE) {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    z: size * 1.5 * r,
  };
}

function hexCorner(centerX, centerZ, index, size = HEX_SIZE) {
  const angle = (Math.PI / 180) * (60 * index - 30);
  return {
    x: centerX + size * Math.cos(angle),
    z: centerZ + size * Math.sin(angle),
  };
}

function hexDistance(first, second) {
  const dq = first.q - second.q;
  const dr = first.r - second.r;
  const ds = -first.q - first.r + second.q + second.r;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

function validNumberPlacement(hexes, numbers) {
  for (let first = 0; first < hexes.length; first += 1) {
    if (numbers[first] !== 6 && numbers[first] !== 8) continue;
    for (let second = first + 1; second < hexes.length; second += 1) {
      const highValue = numbers[second] === 6 || numbers[second] === 8;
      if (highValue && hexDistance(hexes[first], hexes[second]) === 1) {
        return false;
      }
    }
  }
  return true;
}

/* 按角点把地块分组：同一组就是同一个交点，组里 3 片地的那种是「三岔交点」。
   角点键必须和下面建顶点时用的一致，不然分组和真实交点对不上。 */
function groupHexesByCorner(hexes) {
  const groups = new Map();
  hexes.forEach((hex, index) => {
    const world = axialToWorld(hex.q, hex.r);
    for (let corner = 0; corner < 6; corner += 1) {
      const point = hexCorner(world.x, world.z, corner);
      const key = `${Math.round(point.x * 1000)},${Math.round(point.z * 1000)}`;
      const bucket = groups.get(key);
      if (bucket) bucket.push(index);
      else groups.set(key, [index]);
    }
  });
  return groups;
}

/* 一个交点不许接壤三片相同资源：三片同色会让这个点变成唯一落子答案，
   先手直接站上去就赢在起跑线。只有 3 片地的交点才可能犯规。 */
function validTerrainPlacement(cornerGroups, terrains) {
  for (const bucket of cornerGroups.values()) {
    if (bucket.length < 3) continue;
    const first = terrains[bucket[0]];
    if (bucket.every((index) => terrains[index] === first)) return false;
  }
  return true;
}

function buildAxialHexes() {
  const hexes = [];
  for (let q = -2; q <= 2; q += 1) {
    for (let r = -2; r <= 2; r += 1) {
      if (Math.abs(-q - r) <= 2) hexes.push({ q, r });
    }
  }
  return hexes;
}

function generateBoard (seed) {
  const rng = seedToRng(seed);
  const baseHexes = buildAxialHexes();
  const cornerGroups = groupHexesByCorner(baseHexes);

  let terrains = null;
  for (let attempt = 0; attempt < 1000 && !terrains; attempt += 1) {
    const candidate = shuffle([...TERRAIN_POOL], rng);
    if (validTerrainPlacement(cornerGroups, candidate)) terrains = candidate;
  }
  if (!terrains) terrains = shuffle([...TERRAIN_POOL], rng);

  let numbers = null;
  for (let attempt = 0; attempt < 1000 && !numbers; attempt += 1) {
    const pool = shuffle([...NUMBER_POOL], rng);
    let poolIndex = 0;
    const candidate = terrains.map((terrain) => {
      if (terrain === "desert") return null;
      const value = pool[poolIndex];
      poolIndex += 1;
      return value;
    });
    if (validNumberPlacement(baseHexes, candidate)) numbers = candidate;
  }

  if (!numbers) {
    let poolIndex = 0;
    numbers = terrains.map((terrain) => {
      if (terrain === "desert") return null;
      const value = NUMBER_POOL[poolIndex];
      poolIndex += 1;
      return value;
    });
  }

  const vertices = [];
  const edges = [];
  const vertexByKey = new Map();
  const edgeByKey = new Map();

  const hexes = baseHexes.map((hex, index) => {
    const world = axialToWorld(hex.q, hex.r);
    const terrain = terrains[index];
    const vertexIds = [];

    for (let corner = 0; corner < 6; corner += 1) {
      const point = hexCorner(world.x, world.z, corner);
      const key = `${Math.round(point.x * 1000)},${Math.round(point.z * 1000)}`;
      let vertex = vertexByKey.get(key);

      if (!vertex) {
        vertex = {
          id: vertices.length,
          x: point.x,
          z: point.z,
          hexIds: [],
          adjacentVertexIds: [],
          edgeIds: [],
          building: null,
          harbor: null,
        };
        vertexByKey.set(key, vertex);
        vertices.push(vertex);
      }

      if (!vertex.hexIds.includes(index)) vertex.hexIds.push(index);
      vertexIds.push(vertex.id);
    }

    const edgeIds = [];
    for (let corner = 0; corner < 6; corner += 1) {
      const first = vertexIds[corner];
      const second = vertexIds[(corner + 1) % 6];
      const low = Math.min(first, second);
      const high = Math.max(first, second);
      const key = `${low}-${high}`;
      let edge = edgeByKey.get(key);

      if (!edge) {
        edge = {
          id: edges.length,
          v1: low,
          v2: high,
          hexIds: [],
          harbor: null,
          road: null,
        };
        edgeByKey.set(key, edge);
        edges.push(edge);
        vertices[low].adjacentVertexIds.push(high);
        vertices[high].adjacentVertexIds.push(low);
        vertices[low].edgeIds.push(edge.id);
        vertices[high].edgeIds.push(edge.id);
      }

      if (!edge.hexIds.includes(index)) edge.hexIds.push(index);
      edgeIds.push(edge.id);
    }

    return {
      id: index,
      q: hex.q,
      r: hex.r,
      x: world.x,
      z: world.z,
      terrain,
      resource: TERRAIN_TO_RESOURCE[terrain],
      number: numbers[index],
      vertexIds,
      edgeIds,
    };
  });

  const coastalEdges = edges
    .filter((edge) => edge.hexIds.length === 1)
    .map((edge) => {
      const first = vertices[edge.v1];
      const second = vertices[edge.v2];
      const x = (first.x + second.x) / 2;
      const z = (first.z + second.z) / 2;
      return { edge, x, z, angle: Math.atan2(z, x) };
    })
    .sort((first, second) => first.angle - second.angle);

  const harborTypes = shuffle([...HARBOR_POOL], rng);
  const usedVertices = new Set();
  const selectedCoastal = [];

  for (let index = 0; index < 9; index += 1) {
    const preferred = Math.floor((index * coastalEdges.length) / 9);
    let picked = null;

    for (let offset = 0; offset < coastalEdges.length; offset += 1) {
      const candidate = coastalEdges[(preferred + offset) % coastalEdges.length];
      const edge = candidate.edge;
      if (usedVertices.has(edge.v1) || usedVertices.has(edge.v2)) continue;
      picked = candidate;
      break;
    }

    if (!picked) picked = coastalEdges[preferred];
    const edge = picked.edge;
    const type = harborTypes[index];
    edge.harbor = { type };
    vertices[edge.v1].harbor = type;
    vertices[edge.v2].harbor = type;
    usedVertices.add(edge.v1);
    usedVertices.add(edge.v2);
    selectedCoastal.push({
      edgeId: edge.id,
      type,
      x: picked.x,
      z: picked.z,
    });
  }

  for (const vertex of vertices) {
    vertex.adjacentVertexIds = [...new Set(vertex.adjacentVertexIds)];
    vertex.edgeIds = [...new Set(vertex.edgeIds)];
  }

  const desert = hexes.find((hex) => hex.terrain === "desert");

  return {
    hexes,
    vertices,
    edges,
    harbors: selectedCoastal,
    robberHexId: desert.id,
  };
}

function seedToRng(seed) {
  let state = 2166136261;
  for (const character of String(seed)) {
    state ^= character.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isVertexFree (board, vertexId) {
  const vertex = board.vertices[vertexId];
  if (!vertex || vertex.building) return false;
  return vertex.adjacentVertexIds.every((adjacentId) => !board.vertices[adjacentId].building);
}

function legalInitialSettlementVertices (board) {
  return board.vertices.filter((vertex) => isVertexFree(board, vertex.id)).map((vertex) => vertex.id);
}

function legalInitialRoadEdges (board, settlementVertexId) {
  const vertex = board.vertices[settlementVertexId];
  if (!vertex) return [];
  return vertex.edgeIds.filter((edgeId) => !board.edges[edgeId].road);
}

function isRoadConnectedToPlayer (board, edgeId, playerId) {
  const edge = board.edges[edgeId];
  if (!edge || edge.road) return false;

  const endpoints = [board.vertices[edge.v1], board.vertices[edge.v2]];
  if (
    endpoints.some(
      (vertex) => vertex.building && vertex.building.playerId !== playerId,
    )
  ) {
    return false;
  }

  return endpoints.some((vertex) => {
    if (vertex.building?.playerId === playerId) return true;
    return vertex.edgeIds.some(
      (connectedEdgeId) =>
        connectedEdgeId !== edgeId &&
        board.edges[connectedEdgeId].road?.playerId === playerId,
    );
  });
}

function legalBuildRoadEdges (board, playerId) {
  return board.edges
    .filter((edge) => isRoadConnectedToPlayer(board, edge.id, playerId))
    .map((edge) => edge.id);
}

function legalBuildSettlementVertices (board, playerId) {
  return board.vertices
    .filter((vertex) => {
      if (vertex.building || !isVertexFree(board, vertex.id)) return false;
      return vertex.edgeIds.some(
        (edgeId) => board.edges[edgeId].road?.playerId === playerId,
      );
    })
    .map((vertex) => vertex.id);
}

function legalBuildCityVertices (board, playerId) {
  return board.vertices
    .filter(
      (vertex) =>
        vertex.building?.playerId === playerId &&
        vertex.building.type === "settlement",
    )
    .map((vertex) => vertex.id);
}

function validateBoard (board) {
  const errors = [];
  if (board.hexes.length !== 19) errors.push(`Expected 19 hexes, got ${board.hexes.length}`);
  if (board.vertices.length !== 54) errors.push(`Expected 54 vertices, got ${board.vertices.length}`);
  if (board.edges.length !== 72) errors.push(`Expected 72 edges, got ${board.edges.length}`);
  if (board.harbors.length !== 9) errors.push(`Expected 9 harbors, got ${board.harbors.length}`);

  for (const resource of RESOURCES) {
    const expected = resource === "wood" || resource === "sheep" || resource === "wheat" ? 4 : 3;
    const actual = board.hexes.filter((hex) => hex.resource === resource).length;
    if (actual !== expected) errors.push(`Expected ${expected} ${resource} hexes, got ${actual}`);
  }

  return errors;
}

exports["HEX_SIZE"] = HEX_SIZE;
exports["generateBoard"] = generateBoard;
exports["isVertexFree"] = isVertexFree;
exports["legalInitialSettlementVertices"] = legalInitialSettlementVertices;
exports["legalInitialRoadEdges"] = legalInitialRoadEdges;
exports["isRoadConnectedToPlayer"] = isRoadConnectedToPlayer;
exports["legalBuildRoadEdges"] = legalBuildRoadEdges;
exports["legalBuildSettlementVertices"] = legalBuildSettlementVertices;
exports["legalBuildCityVertices"] = legalBuildCityVertices;
exports["validateBoard"] = validateBoard;
},
"src/core/rng.js": function(module, exports, __require) {
function hashSeed (value) {
  const text = String(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom (state) {
  state.rngState = (state.rngState + 0x6d2b79f5) >>> 0;
  let value = state.rngState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function createRng (seed) {
  const state = { rngState: hashSeed(seed) };
  return () => nextRandom(state);
}

function shuffle (values, rng) {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const target = Math.floor(rng() * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values;
}


exports["hashSeed"] = hashSeed;
exports["nextRandom"] = nextRandom;
exports["createRng"] = createRng;
exports["shuffle"] = shuffle;
},
"src/bots/random-bot.js": function(module, exports, __require) {
function chooseRandomCommand (view, random = Math.random) {
  if (!view.validCommands?.length) return null;

  if (view.phase === "AWAITING_DISCARD") {
    const discardCommand = view.validCommands.find(
      (command) => command.type === "DISCARD_RESOURCES",
    );
    const player = view.players.find((candidate) => candidate.id === view.viewerId);
    if (discardCommand && player?.resources) {
      return {
        type: "DISCARD_RESOURCES",
        resources: chooseDiscardResources(
          player.resources,
          discardCommand.required,
          random,
        ),
      };
    }
  }

  const bot = view.players?.find((player) => player.id === view.viewerId);
  const commands =
    bot?.isBot === true
      ? view.validCommands.filter((command) => command.type !== "CREATE_TRADE")
      : view.validCommands;
  if (commands.length === 0) return null;

  const index = Math.floor(random() * commands.length);
  return structuredClone(commands[index]);
}

function chooseDiscardResources(resources, required, random) {
  const remaining = { ...resources };
  const selected = Object.fromEntries(
    Object.keys(resources).map((resource) => [resource, 0]),
  );

  for (let count = 0; count < required; count += 1) {
    const available = Object.entries(remaining).filter(([, amount]) => amount > 0);
    if (available.length === 0) break;
    const [resource] = available[Math.floor(random() * available.length)];
    remaining[resource] -= 1;
    selected[resource] += 1;
  }

  return selected;
}

exports["chooseRandomCommand"] = chooseRandomCommand;
},
"src/core/session.js": function(module, exports, __require) {
const { createCommandEnvelope: createCommandEnvelope, createGame: createGame, dispatchCommand: dispatchCommand } = __require("src/core/engine.js");
const { projectPlayerView: projectPlayerView } = __require("src/core/projection.js");

class LocalGameSession {
  constructor(options = {}) {
    this.state = options.state
      ? structuredClone(options.state)
      : createGame(options);
    this.listeners = new Set();
    this.lastResult = null;
  }

  get version() {
    return this.state.version;
  }

  get phase() {
    return this.state.phase;
  }

  dispatch(actorId, command, commandId) {
    const envelope = createCommandEnvelope(this.state, actorId, command, commandId);
    const outcome = dispatchCommand(this.state, envelope);
    this.lastResult = outcome.result;
    if (outcome.result.accepted) this.state = outcome.state;
    this.emit(outcome.result);
    return outcome.result;
  }

  start(actorId = 0) {
    return this.dispatch(actorId, { type: "START_GAME" });
  }

  getView(viewerId) {
    return projectPlayerView(this.state, viewerId);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(result) {
    for (const listener of this.listeners) listener(result);
  }
}

exports["LocalGameSession"] = LocalGameSession;
},
"src/core/engine.js": function(module, exports, __require) {
const { BUILD_COSTS: BUILD_COSTS, COMMAND_TYPES: COMMAND_TYPES, DEFAULT_PLAYER_NAMES: DEFAULT_PLAYER_NAMES, DEVELOPMENT_CARD_COUNTS: DEVELOPMENT_CARD_COUNTS, DEVELOPMENT_CARD_COST: DEVELOPMENT_CARD_COST, DEVELOPMENT_CARD_TYPES: DEVELOPMENT_CARD_TYPES, ERROR_CODES: ERROR_CODES, EVENT_TYPES: EVENT_TYPES, GAME_PHASES: GAME_PHASES, PIECE_LIMITS: PIECE_LIMITS, RESOURCES: RESOURCES, SETUP_STEPS: SETUP_STEPS, STARTING_RESOURCES_PER_TYPE: STARTING_RESOURCES_PER_TYPE, VICTORY_POINTS_TO_WIN: VICTORY_POINTS_TO_WIN } = __require("src/core/constants.js");
const { generateBoard: generateBoard, isRoadConnectedToPlayer: isRoadConnectedToPlayer, isVertexFree: isVertexFree, legalBuildCityVertices: legalBuildCityVertices, legalBuildRoadEdges: legalBuildRoadEdges, legalBuildSettlementVertices: legalBuildSettlementVertices, legalInitialRoadEdges: legalInitialRoadEdges, legalInitialSettlementVertices: legalInitialSettlementVertices } = __require("src/core/board.js");
const { calculateLongestRoadLength: calculateLongestRoadLength } = __require("src/core/awards.js");
const { appendEvent: appendEvent } = __require("src/core/events.js");
const { nextRandom: nextRandom, shuffle: shuffle } = __require("src/core/rng.js");
const { calculateVictoryPoints: calculateVictoryPoints, calculatePublicVictoryPoints: calculatePublicVictoryPoints, createLobbyState: createLobbyState, createResourcePool: createResourcePool, createSetupOrder: createSetupOrder } = __require("src/core/state.js");

const SETUP_COMMANDS = new Set([
  COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
  COMMAND_TYPES.PLACE_INITIAL_ROAD,
]);

const BUILD_COMMANDS = new Set([
  COMMAND_TYPES.BUILD_ROAD,
  COMMAND_TYPES.BUILD_SETTLEMENT,
  COMMAND_TYPES.BUILD_CITY,
]);

const DEVELOPMENT_CARD_PLAY_COMMANDS = new Set([
  COMMAND_TYPES.PLAY_KNIGHT,
  COMMAND_TYPES.PLAY_ROAD_BUILDING,
  COMMAND_TYPES.PLAY_YEAR_OF_PLENTY,
  COMMAND_TYPES.PLAY_MONOPOLY,
]);

const TRADE_COMMANDS = new Set([
  COMMAND_TYPES.TRADE_WITH_BANK,
  COMMAND_TYPES.CREATE_TRADE,
  COMMAND_TYPES.RESPOND_TO_TRADE,
  COMMAND_TYPES.CONFIRM_TRADE,
  COMMAND_TYPES.CANCEL_TRADE,
]);

function dispatchCommand (state, envelope) {
  if (envelope.gameId && envelope.gameId !== state.gameId) {
    return rejected(state, envelope, ERROR_CODES.GAME_NOT_FOUND, "Game does not exist.");
  }

  if (envelope.expectedVersion !== state.version) {
    return rejected(
      state,
      envelope,
      ERROR_CODES.VERSION_CONFLICT,
      `Expected version ${state.version}, received ${envelope.expectedVersion}.`,
    );
  }

  const validation = validateCommand(state, envelope.actorId, envelope.command);
  if (!validation.ok) {
    return rejected(state, envelope, validation.code, validation.message, validation.details);
  }

  const draft = structuredClone(state);
  draft.version = state.version + 1;
  const events = applyCommand(draft, envelope.actorId, envelope.command);

  return {
    state: draft,
    result: {
      commandId: envelope.commandId,
      accepted: true,
      version: draft.version,
      events,
      error: null,
    },
  };
}

function createCommandEnvelope (state, actorId, command, commandId) {
  return {
    commandId: commandId || createId("command"),
    gameId: state.gameId,
    actorId,
    expectedVersion: state.version,
    command,
  };
}

function createDefaultPlayers (playerCount = 4) {
  return Array.from({ length: playerCount }, (_, index) => ({
    name: DEFAULT_PLAYER_NAMES[index] || `Player ${index + 1}`,
    isBot: index > 0,
  }));
}

function createGame (options = {}) {
  return createLobbyState({
    players: options.players || createDefaultPlayers(),
    seed: options.seed,
    gameId: options.gameId,
  });
}

function validateCommand (state, actorId, command) {
  if (!command || typeof command.type !== "string") {
    return invalid(ERROR_CODES.UNKNOWN_COMMAND, "Command type is required.");
  }

  if (command.type === COMMAND_TYPES.START_GAME) {
    if (state.phase !== GAME_PHASES.LOBBY) {
      return invalid(ERROR_CODES.GAME_ALREADY_STARTED, "Game has already started.");
    }
    if (actorId !== 0) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "Only the host can start the game.");
    }
    if (state.players.length < 3 || state.players.length > 4) {
      return invalid(ERROR_CODES.INVALID_PLAYER_COUNT, "Base game requires 3 or 4 players.");
    }
    return valid();
  }

  const player = state.players[actorId];
  if (!player) {
    return invalid(ERROR_CODES.PLAYER_NOT_FOUND, "Player does not exist.");
  }

  if (state.trade && !TRADE_COMMANDS.has(command.type)) {
    return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already waiting for a response.");
  }

  if (command.type === COMMAND_TYPES.TRADE_WITH_BANK) {
    if (state.trade) {
      return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already open.");
    }
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Bank trade is only allowed after rolling.");
    }
    const giveResource = command.giveResource;
    const receiveResource = command.receiveResource;
    const giveAmount = Number(command.giveAmount);
    const receiveAmount = Number(command.receiveAmount);
    if (
      !RESOURCES.includes(giveResource) ||
      !RESOURCES.includes(receiveResource) ||
      giveResource === receiveResource ||
      !Number.isInteger(giveAmount) ||
      !Number.isInteger(receiveAmount) ||
      giveAmount <= 0 ||
      receiveAmount <= 0
    ) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Trade resources are invalid.");
    }
    const ratio = getBestTradeRatio(state, actorId, giveResource);
    if (giveAmount !== ratio * receiveAmount) {
      return invalid(ERROR_CODES.INVALID_TRADE_RATIO, `Bank trade ratio must be ${ratio}:1.`, {
        ratio,
      });
    }
    if (player.resources[giveResource] < giveAmount) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources to give.");
    }
    if (state.bank[receiveResource] < receiveAmount) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Bank does not have enough resources.", {
        resource: receiveResource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CREATE_TRADE) {
    if (state.trade) {
      return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already open.");
    }
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Trade is only allowed after rolling.");
    }
    const offerValidation = validateTradePool(command.offer);
    if (!offerValidation.ok) return offerValidation;
    const requestValidation = validateTradePool(command.request);
    if (!requestValidation.ok) return requestValidation;
    for (const resource of RESOURCES) {
      if (player.resources[resource] < Number(command.offer[resource] || 0)) {
        return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, `Not enough ${resource} to offer.`);
      }
    }
    const targetPlayerIds = normalizeTradeTargets(state.players, actorId, command.targetPlayerIds);
    if (targetPlayerIds.length === 0) {
      return invalid(ERROR_CODES.INVALID_TRADE, "Trade requires at least one target.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.RESPOND_TO_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId === actorId || !state.trade.targetPlayerIds.includes(actorId)) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Player is not a target of this trade.");
    }
    if (state.trade.responses[actorId]) {
      return invalid(
        ERROR_CODES.TRADE_ALREADY_RESPONDED,
        "Player has already responded to this trade.",
      );
    }
    if (state.trade.currentResponderPlayerId !== actorId) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "Another player must respond to the trade first.",
      );
    }
    if (command.accepted && !canFulfillTradeRequest(state, actorId)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Player cannot fulfill this trade.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CONFIRM_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Only the creator can confirm this trade.");
    }
    if (
      Object.keys(state.trade.responses).length <
      state.trade.targetPlayerIds.length
    ) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "All trade targets must respond first.",
      );
    }
    const targetPlayerId = Number(command.partnerId);
    if (!state.trade.targetPlayerIds.includes(targetPlayerId)) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Partner is not a trade target.");
    }
    if (state.trade.responses[targetPlayerId] !== "ACCEPTED") {
      return invalid(ERROR_CODES.TRADE_TARGET_NOT_ACCEPTED, "Partner has not accepted the trade.");
    }
    if (!tradeResourcesStillAvailable(state, targetPlayerId)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Trade resources are no longer available.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CANCEL_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Only the creator can cancel this trade.");
    }
    if (
      Object.keys(state.trade.responses).length <
      state.trade.targetPlayerIds.length
    ) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "All trade targets must respond first.",
      );
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.BUY_DEVELOPMENT_CARD) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Development cards can only be bought after rolling.");
    }
    if (state.developmentDeck.length === 0) {
      return invalid(ERROR_CODES.DEVELOPMENT_DECK_EMPTY, "The development deck is empty.");
    }
    if (!canAffordCost(player, DEVELOPMENT_CARD_COST)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources to buy a card.", {
        cost: DEVELOPMENT_CARD_COST,
      });
    }
    return valid();
  }

  if (DEVELOPMENT_CARD_PLAY_COMMANDS.has(command.type)) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (
      state.phase !== GAME_PHASES.AWAITING_ROLL &&
      state.phase !== GAME_PHASES.TURN_ACTIONS
    ) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Development cards cannot be played now.");
    }
    const expectedType = developmentCardTypeForCommand(command.type);
    const cardValidation = validatePlayableDevelopmentCard(
      state,
      player,
      command.cardId,
      expectedType,
    );
    if (!cardValidation.ok) return cardValidation;

    if (
      command.type === COMMAND_TYPES.PLAY_ROAD_BUILDING &&
      !hasPieceAvailable(player, "road")
    ) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.");
    }
    if (
      command.type === COMMAND_TYPES.PLAY_MONOPOLY &&
      !RESOURCES.includes(command.resource)
    ) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Monopoly resource is invalid.", {
        resource: command.resource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.REVEAL_VICTORY_POINT) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (
      state.phase !== GAME_PHASES.AWAITING_ROLL &&
      state.phase !== GAME_PHASES.TURN_ACTIONS
    ) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Victory point cards cannot be revealed now.");
    }
    const card = player.developmentCards.find((candidate) => candidate.id === command.cardId);
    if (!card || card.type !== DEVELOPMENT_CARD_TYPES.VICTORY_POINT) {
      return invalid(ERROR_CODES.CARD_NOT_OWNED, "Victory point card was not found.");
    }
    if (card.revealed) {
      return invalid(ERROR_CODES.CARD_NOT_PLAYABLE, "Victory point card is already revealed.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.PLACE_FREE_ROAD) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_FREE_ROAD) {
      return invalid(ERROR_CODES.FREE_ROAD_NOT_AVAILABLE, "No free road is pending.");
    }
    const edgeId = Number(command.edgeId);
    const edge = state.board?.edges[edgeId];
    if (!edge) {
      return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
    }
    if (edge.road) {
      return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
    }
    if (!isRoadConnectedToPlayer(state.board, edgeId, actorId)) {
      return invalid(ERROR_CODES.ROAD_NOT_CONNECTED, "Free road must connect to this player's network.");
    }
    if (!hasPieceAvailable(state.players[actorId], "road")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CHOOSE_RESOURCE) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
      return invalid(ERROR_CODES.INVALID_PHASE, "No resource choice is pending.");
    }
    if (!RESOURCES.includes(command.resource)) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Resource is invalid.", {
        resource: command.resource,
      });
    }
    if (state.bank[command.resource] <= 0) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Bank does not have that resource.", {
        resource: command.resource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.DISCARD_RESOURCES) {
    if (state.phase !== GAME_PHASES.AWAITING_DISCARD) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The game is not waiting for discards.");
    }
    const required = state.pendingAction?.requiredByPlayer?.[actorId] || 0;
    if (required <= 0) {
      return invalid(ERROR_CODES.DISCARD_NOT_REQUIRED, "This player does not need to discard.");
    }
    const resources = command.resources || {};
    const total = RESOURCES.reduce(
      (sum, resource) => sum + Number(resources[resource] || 0),
      0,
    );
    if (total !== required) {
      return invalid(
        ERROR_CODES.DISCARD_COUNT_MISMATCH,
        `Player must discard exactly ${required} resources.`,
        { required, received: total },
      );
    }
    for (const resource of RESOURCES) {
      const amount = Number(resources[resource] || 0);
      if (!Number.isInteger(amount) || amount < 0) {
        return invalid(ERROR_CODES.DISCARD_COUNT_MISMATCH, "Discard amounts must be positive integers.");
      }
      if (amount > player.resources[resource]) {
        return invalid(
          ERROR_CODES.INSUFFICIENT_RESOURCES,
          `Player does not have enough ${resource}.`,
          { resource, amount, available: player.resources[resource] },
        );
      }
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.MOVE_ROBBER) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_ROBBER_MOVE) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The robber cannot be moved now.");
    }
    const hexId = Number(command.hexId);
    const hex = state.board?.hexes[hexId];
    if (!hex) {
      return invalid(ERROR_CODES.INVALID_HEX, "Hex does not exist.");
    }
    if (hexId === state.robberHexId) {
      return invalid(ERROR_CODES.ROBBER_SAME_HEX, "Robber must move to another hex.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CHOOSE_STEAL_TARGET) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_STEAL_TARGET) {
      return invalid(ERROR_CODES.INVALID_PHASE, "A steal target cannot be chosen now.");
    }
    const targetPlayerId = Number(command.playerId);
    if (!state.pendingAction?.candidatePlayerIds?.includes(targetPlayerId)) {
      return invalid(
        ERROR_CODES.INVALID_STEAL_TARGET,
        "Target player is not a valid steal target.",
        { targetPlayerId },
      );
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.ROLL_DICE) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.turn.hasRolled) {
      return invalid(ERROR_CODES.ALREADY_ROLLED, "This player has already rolled.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_ROLL) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The game is not waiting for a roll.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.END_TURN) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The current player cannot end the turn yet.");
    }
    return valid();
  }

  if (BUILD_COMMANDS.has(command.type)) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Building is only allowed after rolling.");
    }
    return validateBuildCommand(state, actorId, command);
  }

  if (!SETUP_COMMANDS.has(command.type)) {
    return invalid(ERROR_CODES.UNKNOWN_COMMAND, `Unsupported command: ${command.type}`);
  }

  if (
    state.phase !== GAME_PHASES.SETUP_ROUND_1 &&
    state.phase !== GAME_PHASES.SETUP_ROUND_2
  ) {
    return invalid(ERROR_CODES.INVALID_PHASE, "Command is only valid during setup.");
  }

  if (state.currentPlayerId !== actorId) {
    return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's setup turn.");
  }

  if (command.type === COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT) {
    if (state.setup.step !== SETUP_STEPS.SETTLEMENT) {
      return invalid(ERROR_CODES.INVALID_SETUP_STEP, "A road must be placed first.");
    }
    const vertexId = Number(command.vertexId);
    const vertex = state.board?.vertices[vertexId];
    if (!vertex) {
      return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
    }
    if (vertex.building) {
      return invalid(ERROR_CODES.OCCUPIED_VERTEX, "Vertex is already occupied.", { vertexId });
    }
    if (!isVertexFree(state.board, vertexId)) {
      return invalid(
        ERROR_CODES.DISTANCE_RULE_VIOLATION,
        "Settlement violates the distance rule.",
        { vertexId },
      );
    }
    return valid();
  }

  if (state.setup.step !== SETUP_STEPS.ROAD) {
    return invalid(ERROR_CODES.INVALID_SETUP_STEP, "A settlement must be placed first.");
  }

  const edgeId = Number(command.edgeId);
  const edge = state.board?.edges[edgeId];
  if (!edge) {
    return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
  }
  if (edge.road) {
    return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
  }
  const settlementVertexId = state.setup.lastSettlementVertexId;
  if (edge.v1 !== settlementVertexId && edge.v2 !== settlementVertexId) {
    return invalid(
      ERROR_CODES.ROAD_NOT_CONNECTED,
      "Initial road must connect to the settlement just placed.",
      { edgeId, settlementVertexId },
    );
  }
  return valid();
}

function getValidCommands (state, playerId) {
  if (state.phase === GAME_PHASES.AWAITING_DISCARD) {
    const required = state.pendingAction?.requiredByPlayer?.[playerId] || 0;
    return required > 0
      ? [{ type: COMMAND_TYPES.DISCARD_RESOURCES, required }]
      : [];
  }

  if (state.phase === GAME_PHASES.AWAITING_FREE_ROAD) {
    if (state.currentPlayerId !== playerId) return [];
    return legalBuildRoadEdges(state.board, playerId).map((edgeId) => ({
      type: COMMAND_TYPES.PLACE_FREE_ROAD,
      edgeId,
    }));
  }

  if (state.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
    if (state.currentPlayerId !== playerId) return [];
    return RESOURCES.filter((resource) => state.bank[resource] > 0).map((resource) => ({
      type: COMMAND_TYPES.CHOOSE_RESOURCE,
      resource,
    }));
  }

  if (state.trade) {
    if (state.trade.fromPlayerId === playerId) {
      if (
        Object.keys(state.trade.responses).length <
        state.trade.targetPlayerIds.length
      ) {
        return [];
      }
      return [
        ...state.trade.targetPlayerIds
          .filter(
            (targetPlayerId) =>
              state.trade.responses[targetPlayerId] === "ACCEPTED" &&
              tradeResourcesStillAvailable(state, targetPlayerId),
          )
          .map((partnerId) => ({
            type: COMMAND_TYPES.CONFIRM_TRADE,
            partnerId,
          })),
        { type: COMMAND_TYPES.CANCEL_TRADE },
      ];
    }
    if (
      state.trade.currentResponderPlayerId === playerId &&
      !state.trade.responses[playerId]
    ) {
      const commands = [
        { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: false },
      ];
      if (canFulfillTradeRequest(state, playerId)) {
        commands.unshift({ type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: true });
      }
      return commands;
    }
    return [];
  }

  if (state.currentPlayerId !== playerId) return [];
  if (state.phase === GAME_PHASES.GAME_OVER) return [];

  if (state.phase === GAME_PHASES.AWAITING_ROLL) {
    return state.board
      ? [
          { type: COMMAND_TYPES.ROLL_DICE },
          ...getPlayableDevelopmentCardCommands(state, state.players[playerId]),
        ]
      : [];
  }

  if (state.phase === GAME_PHASES.TURN_ACTIONS) {
    const player = state.players[playerId];
    const commands = [];

    if (canAfford(player, "road") && hasPieceAvailable(player, "road")) {
      commands.push(
        ...legalBuildRoadEdges(state.board, playerId).map((edgeId) => ({
          type: COMMAND_TYPES.BUILD_ROAD,
          edgeId,
        })),
      );
    }

    if (canAfford(player, "settlement") && hasPieceAvailable(player, "settlement")) {
      commands.push(
        ...legalBuildSettlementVertices(state.board, playerId).map((vertexId) => ({
          type: COMMAND_TYPES.BUILD_SETTLEMENT,
          vertexId,
        })),
      );
    }

    if (canAfford(player, "city") && hasPieceAvailable(player, "city")) {
      commands.push(
        ...legalBuildCityVertices(state.board, playerId).map((vertexId) => ({
          type: COMMAND_TYPES.BUILD_CITY,
          vertexId,
        })),
      );
    }

    if (
      state.developmentDeck.length > 0 &&
      canAffordCost(player, DEVELOPMENT_CARD_COST)
    ) {
      commands.push({ type: COMMAND_TYPES.BUY_DEVELOPMENT_CARD });
    }

    commands.push(...getPlayableDevelopmentCardCommands(state, player));
    commands.push(...getTradeCommands(state, player));
    commands.push({ type: COMMAND_TYPES.END_TURN });
    return commands;
  }

  if (state.phase === GAME_PHASES.AWAITING_ROBBER_MOVE) {
    return state.board.hexes
      .filter((hex) => hex.id !== state.robberHexId)
      .map((hex) => ({
        type: COMMAND_TYPES.MOVE_ROBBER,
        hexId: hex.id,
      }));
  }

  if (state.phase === GAME_PHASES.AWAITING_STEAL_TARGET) {
    return (state.pendingAction?.candidatePlayerIds || []).map((targetPlayerId) => ({
      type: COMMAND_TYPES.CHOOSE_STEAL_TARGET,
      playerId: targetPlayerId,
    }));
  }

  if (!state.board) return [];

  if (
    state.phase !== GAME_PHASES.SETUP_ROUND_1 &&
    state.phase !== GAME_PHASES.SETUP_ROUND_2
  ) {
    return [];
  }

  if (state.setup.step === SETUP_STEPS.SETTLEMENT) {
    return legalInitialSettlementVertices(state.board).map((vertexId) => ({
      type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
      vertexId,
    }));
  }

  return legalInitialRoadEdges(
    state.board,
    state.setup.lastSettlementVertexId,
  ).map((edgeId) => ({
    type: COMMAND_TYPES.PLACE_INITIAL_ROAD,
    edgeId,
  }));
}

function validateBuildCommand(state, playerId, command) {
  const player = state.players[playerId];

  if (command.type === COMMAND_TYPES.BUILD_ROAD) {
    const edgeId = Number(command.edgeId);
    const edge = state.board?.edges[edgeId];
    if (!edge) {
      return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
    }
    if (edge.road) {
      return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
    }
    if (!isRoadConnectedToPlayer(state.board, edgeId, playerId)) {
      return invalid(
        ERROR_CODES.ROAD_NOT_CONNECTED,
        "Road must connect to this player's network.",
        { edgeId },
      );
    }
    if (!hasPieceAvailable(player, "road")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.", {
        limit: PIECE_LIMITS.road,
      });
    }
    if (!canAfford(player, "road")) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources for a road.", {
        cost: BUILD_COSTS.road,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.BUILD_SETTLEMENT) {
    const vertexId = Number(command.vertexId);
    const vertex = state.board?.vertices[vertexId];
    if (!vertex) {
      return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
    }
    if (vertex.building) {
      return invalid(ERROR_CODES.OCCUPIED_VERTEX, "Vertex is already occupied.", { vertexId });
    }
    if (!isVertexFree(state.board, vertexId)) {
      return invalid(
        ERROR_CODES.DISTANCE_RULE_VIOLATION,
        "Settlement violates the distance rule.",
        { vertexId },
      );
    }
    const connected = vertex.edgeIds.some(
      (edgeId) => state.board.edges[edgeId].road?.playerId === playerId,
    );
    if (!connected) {
      return invalid(
        ERROR_CODES.ROAD_NOT_CONNECTED,
        "Settlement must connect to this player's road.",
        { vertexId },
      );
    }
    if (!hasPieceAvailable(player, "settlement")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No settlements remain.", {
        limit: PIECE_LIMITS.settlement,
      });
    }
    if (!canAfford(player, "settlement")) {
      return invalid(
        ERROR_CODES.INSUFFICIENT_RESOURCES,
        "Not enough resources for a settlement.",
        { cost: BUILD_COSTS.settlement },
      );
    }
    return valid();
  }

  const vertexId = Number(command.vertexId);
  const vertex = state.board?.vertices[vertexId];
  if (!vertex) {
    return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
  }
  if (
    vertex.building?.playerId !== playerId ||
    vertex.building.type !== "settlement"
  ) {
    return invalid(ERROR_CODES.INVALID_BUILDING, "City must upgrade this player's settlement.", {
      vertexId,
    });
  }
  if (!hasPieceAvailable(player, "city")) {
    return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No cities remain.", {
      limit: PIECE_LIMITS.city,
    });
  }
  if (!canAfford(player, "city")) {
    return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources for a city.", {
      cost: BUILD_COSTS.city,
    });
  }
  return valid();
}

function canAfford(player, buildType) {
  return Object.entries(BUILD_COSTS[buildType]).every(
    ([resource, amount]) => player.resources[resource] >= amount,
  );
}

function canAffordCost(player, cost) {
  return Object.entries(cost).every(
    ([resource, amount]) => player.resources[resource] >= amount,
  );
}

function hasPieceAvailable(player, pieceType) {
  if (pieceType === "road") return player.roads.length < PIECE_LIMITS.road;
  if (pieceType === "settlement") {
    return player.settlements.length < PIECE_LIMITS.settlement;
  }
  return player.cities.length < PIECE_LIMITS.city;
}

function developmentCardTypeForCommand(commandType) {
  if (commandType === COMMAND_TYPES.PLAY_KNIGHT) {
    return DEVELOPMENT_CARD_TYPES.KNIGHT;
  }
  if (commandType === COMMAND_TYPES.PLAY_ROAD_BUILDING) {
    return DEVELOPMENT_CARD_TYPES.ROAD_BUILDING;
  }
  if (commandType === COMMAND_TYPES.PLAY_YEAR_OF_PLENTY) {
    return DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY;
  }
  return DEVELOPMENT_CARD_TYPES.MONOPOLY;
}

function validatePlayableDevelopmentCard(state, player, cardId, expectedType) {
  const card = player.developmentCards.find((candidate) => candidate.id === cardId);
  if (!card || card.type !== expectedType) {
    return invalid(ERROR_CODES.CARD_NOT_OWNED, "Development card was not found.");
  }
  if (player.newDevelopmentCards.includes(card.id)) {
    return invalid(
      ERROR_CODES.CARD_BOUGHT_THIS_TURN,
      "A newly bought card cannot be played this turn.",
    );
  }
  if (player.developmentCardPlayedThisTurn) {
    return invalid(
      ERROR_CODES.ONE_DEV_CARD_PER_TURN,
      "Only one development card can be played each turn.",
    );
  }
  return valid();
}

function getPlayableDevelopmentCardCommands(state, player) {
  const commands = [];

  for (const card of player.developmentCards) {
    if (
      card.type === DEVELOPMENT_CARD_TYPES.VICTORY_POINT &&
      !card.revealed
    ) {
      commands.push({
        type: COMMAND_TYPES.REVEAL_VICTORY_POINT,
        cardId: card.id,
      });
    }
  }

  if (player.developmentCardPlayedThisTurn) return commands;

  for (const card of player.developmentCards) {
    if (player.newDevelopmentCards.includes(card.id)) continue;

    if (card.type === DEVELOPMENT_CARD_TYPES.KNIGHT) {
      commands.push({ type: COMMAND_TYPES.PLAY_KNIGHT, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.ROAD_BUILDING) {
      commands.push({ type: COMMAND_TYPES.PLAY_ROAD_BUILDING, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY) {
      commands.push({ type: COMMAND_TYPES.PLAY_YEAR_OF_PLENTY, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.MONOPOLY) {
      for (const resource of RESOURCES) {
        commands.push({
          type: COMMAND_TYPES.PLAY_MONOPOLY,
          cardId: card.id,
          resource,
        });
      }
    }
  }

  return commands;
}

function applyCommand(state, actorId, command) {
  if (command.type === COMMAND_TYPES.START_GAME) return applyStartGame(state);
  if (command.type === COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT) {
    return applyPlaceInitialSettlement(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.PLACE_INITIAL_ROAD) {
    return applyPlaceInitialRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.ROLL_DICE) {
    return applyRollDice(state, actorId);
  }
  if (command.type === COMMAND_TYPES.END_TURN) {
    return applyEndTurn(state, actorId);
  }
  if (command.type === COMMAND_TYPES.BUILD_ROAD) {
    return applyBuildRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.BUILD_SETTLEMENT) {
    return applyBuildSettlement(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.BUILD_CITY) {
    return applyBuildCity(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.DISCARD_RESOURCES) {
    return applyDiscardResources(state, actorId, command.resources || {});
  }
  if (command.type === COMMAND_TYPES.MOVE_ROBBER) {
    return applyMoveRobber(state, actorId, Number(command.hexId));
  }
  if (command.type === COMMAND_TYPES.CHOOSE_STEAL_TARGET) {
    return applyChooseStealTarget(state, actorId, Number(command.playerId));
  }
  if (command.type === COMMAND_TYPES.BUY_DEVELOPMENT_CARD) {
    return applyBuyDevelopmentCard(state, actorId);
  }
  if (command.type === COMMAND_TYPES.PLAY_KNIGHT) {
    return applyPlayKnight(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_ROAD_BUILDING) {
    return applyPlayRoadBuilding(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_YEAR_OF_PLENTY) {
    return applyPlayYearOfPlenty(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_MONOPOLY) {
    return applyPlayMonopoly(state, actorId, command.cardId, command.resource);
  }
  if (command.type === COMMAND_TYPES.PLACE_FREE_ROAD) {
    return applyPlaceFreeRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.CHOOSE_RESOURCE) {
    return applyChooseResource(state, actorId, command.resource);
  }
  if (command.type === COMMAND_TYPES.REVEAL_VICTORY_POINT) {
    return applyRevealVictoryPoint(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.TRADE_WITH_BANK) {
    return applyTradeWithBank(state, actorId, command);
  }
  if (command.type === COMMAND_TYPES.CREATE_TRADE) {
    return applyCreateTrade(state, actorId, command);
  }
  if (command.type === COMMAND_TYPES.RESPOND_TO_TRADE) {
    return applyRespondToTrade(state, actorId, Boolean(command.accepted));
  }
  if (command.type === COMMAND_TYPES.CONFIRM_TRADE) {
    return applyConfirmTrade(state, actorId, Number(command.partnerId));
  }
  if (command.type === COMMAND_TYPES.CANCEL_TRADE) {
    return applyCancelTrade(state, actorId);
  }
  return [];
}

function applyRollDice(state, playerId) {
  const die1 = Math.floor(nextRandom(state) * 6) + 1;
  const die2 = Math.floor(nextRandom(state) * 6) + 1;
  const total = die1 + die2;
  state.turn.hasRolled = true;
  state.turn.dice = { die1, die2, total };

  const events = [
    appendEvent(state, EVENT_TYPES.DICE_ROLLED, {
      playerId,
      die1,
      die2,
      total,
    }),
  ];

  if (total === 7) {
    events.push(...beginSevenResolution(state, playerId));
    return events;
  }

  const production = resolveResourceProduction(state, total);
  state.turn.production = production.production;
  events.push(...production.events);

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.TURN_ACTIONS;
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.TURN_ACTIONS,
    }),
  );

  return events;
}

function resolveResourceProduction(state, total) {
  const events = [];
  const production = [];

  if (total === 7) {
    return { events, production };
  }

  const demandByResource = Object.fromEntries(
    RESOURCES.map((resource) => [
      resource,
      {
        total: 0,
        hexes: [],
      },
    ]),
  );

  for (const hex of [...state.board.hexes].sort((first, second) => first.id - second.id)) {
    if (hex.number !== total || !hex.resource || hex.id === state.robberHexId) continue;

    const gains = [];
    for (const vertexId of [...hex.vertexIds].sort((first, second) => first - second)) {
      const building = state.board.vertices[vertexId]?.building;
      if (!building) continue;

      const amount = building.type === "city" ? 2 : 1;
      gains.push({ playerId: building.playerId, amount });
      demandByResource[hex.resource].total += amount;
    }

    if (gains.length > 0) {
      gains.sort((first, second) => first.playerId - second.playerId);
      demandByResource[hex.resource].hexes.push({
        hexId: hex.id,
        resource: hex.resource,
        gains,
      });
    }
  }

  for (const resource of RESOURCES) {
    const demand = demandByResource[resource];
    if (demand.total === 0) continue;

    if (state.bank[resource] < demand.total) {
      events.push(
        appendEvent(state, EVENT_TYPES.BANK_RESOURCE_SHORTAGE, {
          resource,
          requested: demand.total,
          available: state.bank[resource],
        }),
      );
      continue;
    }

    state.bank[resource] -= demand.total;
    const playerGains = new Map();

    for (const hex of demand.hexes) {
      for (const gain of hex.gains) {
        const player = state.players[gain.playerId];
        player.resources[resource] += gain.amount;
        playerGains.set(gain.playerId, (playerGains.get(gain.playerId) || 0) + gain.amount);
      }
    }

    for (const hex of demand.hexes) {
      events.push(
        appendEvent(state, EVENT_TYPES.RESOURCES_PRODUCED, {
          hexId: hex.hexId,
          resource,
          gains: hex.gains,
        }),
      );
      production.push(hex);
    }

    for (const [playerId, amount] of [...playerGains.entries()].sort(
      (first, second) => first[0] - second[0],
    )) {
      const gained = createResourcePool();
      gained[resource] = amount;
      events.push(
        appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
          playerId,
          resources: gained,
          source: "DICE_ROLL",
        }),
        appendEvent(
          state,
          EVENT_TYPES.HAND_CHANGED,
          {
            playerId,
            resources: { ...state.players[playerId].resources },
            reason: "DICE_ROLL",
          },
          "PLAYER",
          playerId,
        ),
      );
    }
  }

  return { events, production };
}

function applyEndTurn(state, playerId) {
  const currentIndex = state.players.findIndex((player) => player.id === playerId);
  const nextIndex = (currentIndex + 1) % state.players.length;
  const nextPlayerId = state.players[nextIndex].id;

  const events = [
    appendEvent(state, EVENT_TYPES.TURN_ENDED, {
      playerId,
      turnNumber: state.turnNumber,
    }),
  ];

  state.currentPlayerId = nextPlayerId;
  state.turn = {
    hasRolled: false,
    dice: null,
    production: [],
  };
  for (const player of state.players) {
    player.newDevelopmentCards = [];
    player.developmentCardPlayedThisTurn = false;
  }
  state.pendingAction = null;
  state.trade = null;
  state.phase = GAME_PHASES.AWAITING_ROLL;
  if (nextIndex === 0) state.turnNumber += 1;

  events.push(
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: nextPlayerId,
      turnNumber: state.turnNumber,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: GAME_PHASES.TURN_ACTIONS,
      to: GAME_PHASES.AWAITING_ROLL,
    }),
  );

  return events;
}

function beginSevenResolution(state, activePlayerId) {
  const requiredByPlayer = {};
  for (const player of state.players) {
    const count = countResources(player);
    if (count > 7) requiredByPlayer[player.id] = Math.floor(count / 2);
  }

  if (Object.keys(requiredByPlayer).length === 0) {
    return beginRobberMovePhase(state, activePlayerId, GAME_PHASES.AWAITING_ROLL);
  }

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.AWAITING_DISCARD;
  state.pendingAction = {
    type: "DISCARD",
    playerId: activePlayerId,
    requiredByPlayer,
    resumePhase: GAME_PHASES.TURN_ACTIONS,
  };

  const events = [];
  for (const [playerId, required] of Object.entries(requiredByPlayer)) {
    const numericPlayerId = Number(playerId);
    events.push(
      appendEvent(
        state,
        EVENT_TYPES.DISCARD_REQUIRED,
        {
          playerId: numericPlayerId,
          required,
        },
        "PLAYER",
        numericPlayerId,
      ),
      appendEvent(state, EVENT_TYPES.DISCARD_COUNT_CHANGED, {
        playerId: numericPlayerId,
        required,
        remaining: required,
      }),
    );
  }
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_DISCARD,
    }),
  );
  return events;
}

function beginRobberMovePhase(
  state,
  playerId,
  fromPhase,
  resumePhase = GAME_PHASES.TURN_ACTIONS,
) {
  state.phase = GAME_PHASES.AWAITING_ROBBER_MOVE;
  state.pendingAction = {
    type: "ROBBER_MOVE",
    playerId,
    resumePhase,
  };

  return [
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: fromPhase,
      to: GAME_PHASES.AWAITING_ROBBER_MOVE,
    }),
  ];
}

function applyDiscardResources(state, playerId, resources) {
  const player = state.players[playerId];
  const required = state.pendingAction.requiredByPlayer[playerId];
  const discarded = createResourcePool();

  for (const resource of RESOURCES) {
    const amount = Number(resources[resource] || 0);
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    discarded[resource] = amount;
  }

  delete state.pendingAction.requiredByPlayer[playerId];
  const events = [
    appendEvent(
      state,
      EVENT_TYPES.RESOURCES_DISCARDED,
      {
        playerId,
        resources: discarded,
        required,
      },
      "PLAYER",
      playerId,
    ),
    appendEvent(state, EVENT_TYPES.DISCARD_COUNT_CHANGED, {
      playerId,
      required,
      remaining: 0,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "DISCARD_RESOURCES",
      },
      "PLAYER",
      playerId,
    ),
  ];

  if (Object.keys(state.pendingAction.requiredByPlayer).length === 0) {
    const activePlayerId = state.pendingAction.playerId;
    state.pendingAction = null;
    events.push(
      ...beginRobberMovePhase(state, activePlayerId, GAME_PHASES.AWAITING_DISCARD),
    );
  }

  return events;
}

function applyMoveRobber(state, playerId, hexId) {
  const previousHexId = state.robberHexId;
  state.robberHexId = hexId;

  const events = [
    appendEvent(state, EVENT_TYPES.ROBBER_MOVED, {
      hexId,
      previousHexId,
      movedByPlayerId: playerId,
    }),
  ];
  const candidates = getStealCandidates(state, playerId, hexId);

  if (candidates.length === 0) {
    events.push(...finishRobberResolution(state));
    return events;
  }

  if (candidates.length === 1) {
    events.push(...resolveSteal(state, playerId, candidates[0]));
    return events;
  }

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.AWAITING_STEAL_TARGET;
  state.pendingAction = {
    type: "STEAL_TARGET",
    playerId,
    candidatePlayerIds: candidates,
    resumePhase: GAME_PHASES.TURN_ACTIONS,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_STEAL_TARGET,
    }),
  );
  return events;
}

function applyChooseStealTarget(state, playerId, targetPlayerId) {
  return resolveSteal(state, playerId, targetPlayerId);
}

function getStealCandidates(state, activePlayerId, hexId) {
  const candidates = new Set();
  const hex = state.board.hexes[hexId];

  for (const vertexId of hex.vertexIds) {
    const building = state.board.vertices[vertexId]?.building;
    if (!building || building.playerId === activePlayerId) continue;
    if (countResources(state.players[building.playerId]) > 0) {
      candidates.add(building.playerId);
    }
  }

  return [...candidates].sort((first, second) => first - second);
}

function resolveSteal(state, thiefId, victimId) {
  const victim = state.players[victimId];
  const thief = state.players[thiefId];
  const available = RESOURCES.filter((resource) => victim.resources[resource] > 0);
  const events = [];

  if (available.length > 0) {
    const resource = available[Math.floor(nextRandom(state) * available.length)];
    victim.resources[resource] -= 1;
    thief.resources[resource] += 1;

    events.push(
      appendEvent(
        state,
        EVENT_TYPES.RESOURCE_LOST,
        {
          victimId,
          thiefId,
          resource,
        },
        "PLAYER",
        victimId,
      ),
      appendEvent(
        state,
        EVENT_TYPES.RESOURCE_STOLEN,
        {
          victimId,
          thiefId,
          resource,
        },
        "PLAYER",
        thiefId,
      ),
      appendEvent(state, EVENT_TYPES.STEAL_RESOLVED, {
        victimId,
        thiefId,
        resourceHidden: true,
      }),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: victimId,
          resources: { ...victim.resources },
          reason: "RESOURCE_STOLEN",
        },
        "PLAYER",
        victimId,
      ),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: thiefId,
          resources: { ...thief.resources },
          reason: "RESOURCE_STOLEN",
        },
        "PLAYER",
        thiefId,
      ),
    );
  }

  events.push(...finishRobberResolution(state));
  return events;
}

function finishRobberResolution(state) {
  const previousPhase = state.phase;
  const resumePhase = state.pendingAction?.resumePhase || GAME_PHASES.TURN_ACTIONS;
  state.pendingAction = null;
  state.phase = resumePhase;

  return [
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: resumePhase,
    }),
  ];
}

function countResources(player) {
  return Object.values(player.resources).reduce((total, amount) => total + amount, 0);
}

function getBestTradeRatio(state, playerId, resource) {
  const player = state.players[playerId];
  let ratio = 4;

  for (const vertexId of [...player.settlements, ...player.cities]) {
    const harbor = state.board.vertices[vertexId]?.harbor;
    if (harbor === resource) return 2;
    if (harbor === "any") ratio = Math.min(ratio, 3);
  }
  return ratio;
}

function getTradeCommands(state, player) {
  const commands = [];

  for (const giveResource of RESOURCES) {
    const ratio = getBestTradeRatio(state, player.id, giveResource);
    if (player.resources[giveResource] < ratio) continue;
    for (const receiveResource of RESOURCES) {
      if (receiveResource === giveResource || state.bank[receiveResource] <= 0) continue;
      commands.push({
        type: COMMAND_TYPES.TRADE_WITH_BANK,
        giveResource,
        giveAmount: ratio,
        receiveResource,
        receiveAmount: 1,
      });
    }
  }

  const targetPlayerIds = state.players
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => candidate.id);
  for (const giveResource of RESOURCES) {
    if (player.resources[giveResource] <= 0) continue;
    const giveAmounts = [1];
    for (
      let amount = 2;
      amount <= Math.min(3, player.resources[giveResource]);
      amount += 1
    ) {
      giveAmounts.push(amount);
    }
    for (const requestResource of RESOURCES) {
      if (requestResource === giveResource) continue;
      for (const giveAmount of giveAmounts) {
        commands.push({
          type: COMMAND_TYPES.CREATE_TRADE,
          offer: { [giveResource]: giveAmount },
          request: { [requestResource]: 1 },
          targetPlayerIds,
        });
      }
    }
  }

  return commands;
}

function validateTradePool(pool) {
  if (!pool || typeof pool !== "object") {
    return invalid(ERROR_CODES.INVALID_TRADE, "Trade resources are required.");
  }

  let total = 0;
  for (const [resource, rawAmount] of Object.entries(pool)) {
    const amount = Number(rawAmount);
    if (!RESOURCES.includes(resource) || !Number.isInteger(amount) || amount < 0) {
      return invalid(ERROR_CODES.INVALID_TRADE, "Trade resource amount is invalid.");
    }
    total += amount;
  }
  if (total <= 0) {
    return invalid(ERROR_CODES.INVALID_TRADE, "Trade must include at least one resource.");
  }
  return valid();
}

function normalizeTradeTargets(players, actorId, targetPlayerIds) {
  const requested = Array.isArray(targetPlayerIds)
    ? targetPlayerIds.map(Number)
    : players.filter((player) => player.id !== actorId).map((player) => player.id);
  const unique = [...new Set(requested)];
  if (
    unique.some(
      (playerId) =>
        !Number.isInteger(playerId) ||
        playerId === actorId ||
        !players.some((player) => player.id === playerId),
    )
  ) {
    return [];
  }
  return unique;
}

function tradeResourcesStillAvailable(state, targetPlayerId) {
  const trade = state.trade;
  const fromPlayer = state.players[trade.fromPlayerId];
  const targetPlayer = state.players[targetPlayerId];
  return (
    RESOURCES.every(
      (resource) => fromPlayer.resources[resource] >= Number(trade.offer[resource] || 0),
    ) &&
    RESOURCES.every(
      (resource) => targetPlayer.resources[resource] >= Number(trade.request[resource] || 0),
    )
  );
}

function canFulfillTradeRequest(state, playerId) {
  const trade = state.trade;
  const player = state.players[playerId];
  return RESOURCES.every(
    (resource) => player.resources[resource] >= Number(trade.request[resource] || 0),
  );
}

function applyTradeWithBank(state, playerId, command) {
  const player = state.players[playerId];
  const giveAmount = Number(command.giveAmount);
  const receiveAmount = Number(command.receiveAmount);
  const give = createResourcePool();
  const receive = createResourcePool();
  give[command.giveResource] = giveAmount;
  receive[command.receiveResource] = receiveAmount;
  player.resources[command.giveResource] -= giveAmount;
  state.bank[command.giveResource] += giveAmount;
  state.bank[command.receiveResource] -= receiveAmount;
  player.resources[command.receiveResource] += receiveAmount;

  return [
    appendEvent(state, EVENT_TYPES.BANK_TRADE_COMPLETED, {
      playerId,
      give,
      receive,
      ratio: giveAmount / receiveAmount,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "TRADE_WITH_BANK",
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function applyCreateTrade(state, playerId, command) {
  const targetPlayerIds = normalizeTradeTargets(
    state.players,
    playerId,
    command.targetPlayerIds,
  );
  state.trade = {
    tradeId: createId("trade"),
    fromPlayerId: playerId,
    offer: { ...command.offer },
    request: { ...command.request },
    targetPlayerIds,
    responses: {},
    currentResponderPlayerId:
      targetPlayerIds.length > 0 ? targetPlayerIds[0] : null,
  };

  return [
    appendEvent(state, EVENT_TYPES.TRADE_CREATED, {
      tradeId: state.trade.tradeId,
      fromPlayerId: playerId,
      offer: { ...state.trade.offer },
      request: { ...state.trade.request },
      targets: [...targetPlayerIds],
    }),
  ];
}

function applyRespondToTrade(state, playerId, accepted) {
  state.trade.responses[playerId] = accepted ? "ACCEPTED" : "REJECTED";
  const currentIndex = state.trade.targetPlayerIds.indexOf(playerId);
  state.trade.currentResponderPlayerId =
    state.trade.targetPlayerIds[currentIndex + 1] ?? null;
  const events = [
    appendEvent(state, EVENT_TYPES.TRADE_RESPONSE_RECORDED, {
      tradeId: state.trade.tradeId,
      playerId,
      accepted,
    }),
  ];
  if (state.trade.currentResponderPlayerId === null) {
    events.push(
      appendEvent(state, EVENT_TYPES.TRADE_ROUND_COMPLETED, {
        tradeId: state.trade.tradeId,
        acceptedPlayerIds: Object.entries(state.trade.responses)
          .filter(([, response]) => response === "ACCEPTED")
          .map(([responderId]) => Number(responderId)),
      }),
    );
  }
  return events;
}

function applyConfirmTrade(state, playerId, targetPlayerId) {
  const trade = state.trade;
  const fromPlayer = state.players[playerId];
  const targetPlayer = state.players[targetPlayerId];
  const exchange = {
    offer: { ...trade.offer },
    request: { ...trade.request },
  };

  for (const resource of RESOURCES) {
    const offerAmount = Number(trade.offer[resource] || 0);
    const requestAmount = Number(trade.request[resource] || 0);
    fromPlayer.resources[resource] -= offerAmount;
    targetPlayer.resources[resource] += offerAmount;
    targetPlayer.resources[resource] -= requestAmount;
    fromPlayer.resources[resource] += requestAmount;
  }

  state.trade = null;
  return [
    appendEvent(state, EVENT_TYPES.TRADE_COMPLETED, {
      tradeId: trade.tradeId,
      participants: [playerId, targetPlayerId],
      exchange,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...fromPlayer.resources },
        reason: "TRADE_COMPLETED",
      },
      "PLAYER",
      playerId,
    ),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId: targetPlayerId,
        resources: { ...targetPlayer.resources },
        reason: "TRADE_COMPLETED",
      },
      "PLAYER",
      targetPlayerId,
    ),
  ];
}

function applyCancelTrade(state, playerId) {
  const tradeId = state.trade.tradeId;
  const offer = { ...state.trade.offer };
  const request = { ...state.trade.request };
  const targetPlayerIds = [...state.trade.targetPlayerIds];
  const responses = { ...state.trade.responses };
  state.trade = null;
  return [
    appendEvent(state, EVENT_TYPES.TRADE_CANCELLED, {
      tradeId,
      playerId,
      offer,
      request,
      targetPlayerIds,
      responses,
    }),
  ];
}

function createDevelopmentDeck(state) {
  const cards = [];
  for (const [type, count] of Object.entries(DEVELOPMENT_CARD_COUNTS)) {
    for (let index = 0; index < count; index += 1) {
      cards.push({
        id: `card-${state.developmentCardSequence}`,
        type,
        revealed: false,
      });
      state.developmentCardSequence += 1;
    }
  }
  return shuffle(cards, () => nextRandom(state));
}

function applyBuyDevelopmentCard(state, playerId) {
  const player = state.players[playerId];
  const card = state.developmentDeck.pop();
  const events = [
    ...spendCost(
      state,
      playerId,
      DEVELOPMENT_CARD_COST,
      "BUY_DEVELOPMENT_CARD",
      "developmentCard",
    ),
  ];

  player.developmentCards.push(card);
  player.newDevelopmentCards.push(card.id);
  events.push(
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PURCHASED, {
      playerId,
      remaining: state.developmentDeck.length,
    }),
    appendEvent(
      state,
      EVENT_TYPES.DEVELOPMENT_CARD_DRAWN,
      {
        playerId,
        card: structuredClone(card),
      },
      "PLAYER",
      playerId,
    ),
  );
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyPlayKnight(state, playerId, cardId) {
  const player = state.players[playerId];
  const card = removePlayedDevelopmentCard(player, cardId);
  const previousPhase = state.phase;
  player.knightsPlayed += 1;
  player.developmentCardPlayedThisTurn = true;

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.KNIGHT,
    }),
  ];
  events.push(...updateLargestArmyAward(state, playerId));
  events.push(...checkForWinner(state, playerId));

  if (state.phase !== GAME_PHASES.GAME_OVER) {
    events.push(
      ...beginRobberMovePhase(
        state,
        playerId,
        previousPhase,
        previousPhase,
      ),
    );
  }
  return events;
}

function applyPlayRoadBuilding(state, playerId, cardId) {
  removePlayedDevelopmentCard(state.players[playerId], cardId);
  state.players[playerId].developmentCardPlayedThisTurn = true;
  const previousPhase = state.phase;
  const remaining = Math.min(2, PIECE_LIMITS.road - state.players[playerId].roads.length);

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.ROAD_BUILDING,
    }),
    appendEvent(state, EVENT_TYPES.ROAD_BUILDING_STARTED, {
      playerId,
      roadsRemaining: remaining,
    }),
  ];

  if (remaining <= 0 || legalBuildRoadEdges(state.board, playerId).length === 0) {
    return events;
  }

  state.phase = GAME_PHASES.AWAITING_FREE_ROAD;
  state.pendingAction = {
    type: "FREE_ROAD",
    playerId,
    roadsRemaining: remaining,
    resumePhase: previousPhase,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_FREE_ROAD,
    }),
  );
  return events;
}

function applyPlaceFreeRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);
  state.pendingAction.roadsRemaining -= 1;

  const events = [
    appendEvent(state, EVENT_TYPES.FREE_ROAD_PLACED, {
      playerId,
      edgeId,
      roadsRemaining: state.pendingAction.roadsRemaining,
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  events.push(...checkForWinner(state, playerId));

  if (state.phase === GAME_PHASES.GAME_OVER) return events;

  const noLegalRoads = legalBuildRoadEdges(state.board, playerId).length === 0;
  if (state.pendingAction.roadsRemaining <= 0 || noLegalRoads) {
    const resumePhase = state.pendingAction.resumePhase;
    state.pendingAction = null;
    state.phase = resumePhase;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.AWAITING_FREE_ROAD,
        to: resumePhase,
      }),
    );
  }
  return events;
}

function applyPlayYearOfPlenty(state, playerId, cardId) {
  removePlayedDevelopmentCard(state.players[playerId], cardId);
  state.players[playerId].developmentCardPlayedThisTurn = true;
  const previousPhase = state.phase;
  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY,
    }),
  ];
  const choicesRemaining = Math.min(
    2,
    RESOURCES.reduce((total, resource) => total + state.bank[resource], 0),
  );

  events.push(
    appendEvent(state, EVENT_TYPES.YEAR_OF_PLENTY_STARTED, {
      playerId,
      choicesRemaining,
    }),
  );
  if (choicesRemaining <= 0) return events;

  state.phase = GAME_PHASES.AWAITING_RESOURCE_CHOICE;
  state.pendingAction = {
    type: "YEAR_OF_PLENTY",
    playerId,
    choicesRemaining,
    resumePhase: previousPhase,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_RESOURCE_CHOICE,
    }),
  );
  return events;
}

function applyChooseResource(state, playerId, resource) {
  const player = state.players[playerId];
  state.bank[resource] -= 1;
  player.resources[resource] += 1;
  state.pendingAction.choicesRemaining -= 1;
  const gained = createResourcePool();
  gained[resource] = 1;

  const events = [
    appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
      playerId,
      resources: gained,
      source: "YEAR_OF_PLENTY",
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "YEAR_OF_PLENTY",
      },
      "PLAYER",
      playerId,
    ),
  ];

  const noResourcesLeft = RESOURCES.every((candidate) => state.bank[candidate] <= 0);
  if (state.pendingAction.choicesRemaining <= 0 || noResourcesLeft) {
    const resumePhase = state.pendingAction.resumePhase;
    state.pendingAction = null;
    state.phase = resumePhase;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.AWAITING_RESOURCE_CHOICE,
        to: resumePhase,
      }),
    );
  }
  return events;
}

function applyPlayMonopoly(state, playerId, cardId, resource) {
  const player = state.players[playerId];
  removePlayedDevelopmentCard(player, cardId);
  player.developmentCardPlayedThisTurn = true;
  const gains = [];

  for (const opponent of state.players) {
    if (opponent.id === playerId) continue;
    const amount = opponent.resources[resource];
    if (amount <= 0) continue;
    opponent.resources[resource] = 0;
    player.resources[resource] += amount;
    gains.push({ playerId: opponent.id, amount });
  }

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.MONOPOLY,
    }),
    appendEvent(state, EVENT_TYPES.MONOPOLY_RESOLVED, {
      playerId,
      resource,
      gains,
    }),
  ];

  for (const gain of gains) {
    events.push(
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: gain.playerId,
          resources: { ...state.players[gain.playerId].resources },
          reason: "MONOPOLY",
        },
        "PLAYER",
        gain.playerId,
      ),
    );
  }
  events.push(
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "MONOPOLY",
      },
      "PLAYER",
      playerId,
    ),
  );
  return events;
}

function applyRevealVictoryPoint(state, playerId, cardId) {
  const player = state.players[playerId];
  const card = player.developmentCards.find((candidate) => candidate.id === cardId);
  card.revealed = true;

  const events = [
    appendEvent(state, EVENT_TYPES.VICTORY_POINT_REVEALED, {
      playerId,
      cardId,
      value: 1,
    }),
  ];
  events.push(...checkForWinner(state, playerId));
  return events;
}

function removePlayedDevelopmentCard(player, cardId) {
  const index = player.developmentCards.findIndex((card) => card.id === cardId);
  const [card] = player.developmentCards.splice(index, 1);
  return card;
}

function updateLargestArmyAward(state, playerId) {
  const currentHolder = state.awards.largestArmy;
  const player = state.players[playerId];
  if (player.knightsPlayed < 3) return [];

  let nextHolder = currentHolder;
  if (currentHolder === null) {
    const maxKnights = Math.max(...state.players.map((candidate) => candidate.knightsPlayed));
    const leaders = state.players.filter(
      (candidate) => candidate.knightsPlayed === maxKnights,
    );
    if (maxKnights >= 3 && leaders.length === 1) {
      nextHolder = leaders[0].id;
    }
  } else {
    const currentKnights = state.players[currentHolder].knightsPlayed;
    if (player.knightsPlayed > currentKnights) {
      const maxKnights = Math.max(...state.players.map((candidate) => candidate.knightsPlayed));
      const leaders = state.players.filter(
        (candidate) => candidate.knightsPlayed === maxKnights,
      );
      if (leaders.length === 1 && leaders[0].id === playerId) {
        nextHolder = playerId;
      }
    }
  }

  if (nextHolder === currentHolder) return [];
  state.awards.largestArmy = nextHolder;
  return [
    appendEvent(state, EVENT_TYPES.LARGEST_ARMY_CHANGED, {
      previousPlayerId: currentHolder,
      newPlayerId: nextHolder,
      size: state.players[nextHolder].knightsPlayed,
    }),
  ];
}

function updateLongestRoadAward(state) {
  const lengths = state.players.map((player) => ({
    playerId: player.id,
    length: calculateLongestRoadLength(state.board, player.id),
  }));
  const currentHolder = state.awards.longestRoad;
  const currentLength = currentHolder === null
    ? 0
    : lengths.find((entry) => entry.playerId === currentHolder).length;
  const maxLength = Math.max(...lengths.map((entry) => entry.length));
  const leaders = lengths.filter((entry) => entry.length === maxLength);
  let nextHolder = currentHolder;

  if (currentHolder !== null && currentLength < 5) {
    nextHolder = null;
  }

  if (nextHolder === null) {
    if (maxLength >= 5 && leaders.length === 1) nextHolder = leaders[0].playerId;
  } else {
    const holderLength = lengths.find((entry) => entry.playerId === nextHolder).length;
    if (maxLength > holderLength && leaders.length === 1) {
      nextHolder = leaders[0].playerId;
    }
  }

  if (nextHolder === currentHolder) return [];
  state.awards.longestRoad = nextHolder;
  return [
    appendEvent(state, EVENT_TYPES.LONGEST_ROAD_CHANGED, {
      previousPlayerId: currentHolder,
      newPlayerId: nextHolder,
      length: nextHolder === null
        ? 0
        : lengths.find((entry) => entry.playerId === nextHolder).length,
    }),
  ];
}

function spendCost(state, playerId, cost, reason, source) {
  const player = state.players[playerId];
  const spent = createResourcePool();

  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    spent[resource] = amount;
  }

  return [
    appendEvent(state, EVENT_TYPES.RESOURCES_SPENT, {
      playerId,
      resources: spent,
      buildType: source,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason,
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function applyBuildRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);

  const events = [
    ...spendResources(state, playerId, "road"),
    appendEvent(state, EVENT_TYPES.ROAD_PLACED, {
      playerId,
      edgeId,
      isInitial: false,
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyBuildSettlement(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  vertex.building = { playerId, type: "settlement" };
  player.settlements.push(vertexId);

  const victoryPoints = calculatePublicVictoryPoints(state, playerId);
  const events = [
    ...spendResources(state, playerId, "settlement"),
    appendEvent(state, EVENT_TYPES.SETTLEMENT_PLACED, {
      playerId,
      vertexId,
      isInitial: false,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.VICTORY_POINTS_CHANGED, {
      playerId,
      value: victoryPoints,
      reason: "BUILD_SETTLEMENT",
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  if (state.awards.longestRoad !== null) {
    events.push(...checkForWinner(state, state.awards.longestRoad));
  }
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyBuildCity(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  player.settlements = player.settlements.filter((settlementId) => settlementId !== vertexId);
  player.cities.push(vertexId);
  vertex.building = { playerId, type: "city" };

  const victoryPoints = calculatePublicVictoryPoints(state, playerId);
  const events = [
    ...spendResources(state, playerId, "city"),
    appendEvent(state, EVENT_TYPES.CITY_PLACED, {
      playerId,
      vertexId,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.VICTORY_POINTS_CHANGED, {
      playerId,
      value: victoryPoints,
      reason: "BUILD_CITY",
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  if (state.awards.longestRoad !== null) {
    events.push(...checkForWinner(state, state.awards.longestRoad));
  }
  events.push(...checkForWinner(state, playerId));
  return events;
}

function spendResources(state, playerId, buildType) {
  const player = state.players[playerId];
  const cost = BUILD_COSTS[buildType];
  const spent = createResourcePool();

  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    spent[resource] = amount;
  }

  return [
    appendEvent(state, EVENT_TYPES.RESOURCES_SPENT, {
      playerId,
      resources: spent,
      buildType,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: `BUILD_${buildType.toUpperCase()}`,
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function checkForWinner(state, playerId) {
  const victoryPoints = calculateVictoryPoints(state, playerId);
  if (victoryPoints < VICTORY_POINTS_TO_WIN || state.winnerId !== null) return [];

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.GAME_OVER;
  state.winnerId = playerId;
  const revealedCards = [];
  for (const card of state.players[playerId].developmentCards) {
    if (card.type !== DEVELOPMENT_CARD_TYPES.VICTORY_POINT || card.revealed) continue;
    card.revealed = true;
    revealedCards.push(
      appendEvent(state, EVENT_TYPES.VICTORY_POINT_REVEALED, {
        playerId,
        cardId: card.id,
        value: 1,
      }),
    );
  }

  return [
    ...revealedCards,
    appendEvent(state, EVENT_TYPES.GAME_ENDED, {
      winnerId: playerId,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.GAME_OVER,
    }),
  ];
}

function applyStartGame(state) {
  state.board = generateBoard(state.seed);
  state.developmentDeck = createDevelopmentDeck(state);
  state.awards = {
    longestRoad: null,
    largestArmy: null,
  };
  for (const player of state.players) {
    player.developmentCards = [];
    player.newDevelopmentCards = [];
    player.developmentCardPlayedThisTurn = false;
    player.knightsPlayed = 0;
  }
  state.setup.order = createSetupOrder(state.players.length);
  state.setup.index = 0;
  state.setup.step = SETUP_STEPS.SETTLEMENT;
  state.setup.lastSettlementVertexId = null;
  state.phase = GAME_PHASES.SETUP_ROUND_1;
  state.currentPlayerId = state.setup.order[0];
  state.robberHexId = state.board.robberHexId;
  state.pendingAction = null;
  state.trade = null;

  const events = [
    appendEvent(state, EVENT_TYPES.GAME_STARTED, {
      playerIds: state.players.map((player) => player.id),
      seed: state.seed,
    }),
    appendEvent(state, EVENT_TYPES.BOARD_CREATED, {
      hexCount: state.board.hexes.length,
      harborCount: state.board.harbors.length,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: GAME_PHASES.LOBBY,
      to: GAME_PHASES.SETUP_ROUND_1,
    }),
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: state.currentPlayerId,
      setupIndex: state.setup.index,
    }),
  ];

  events.push(...grantStartingResources(state));
  return events;
}

function grantStartingResources(state) {
  const gained = createResourcePool(STARTING_RESOURCES_PER_TYPE);
  const events = [];

  for (const resource of RESOURCES) {
    state.bank[resource] -= state.players.length * STARTING_RESOURCES_PER_TYPE;
  }

  for (const player of state.players) {
    for (const resource of RESOURCES) {
      player.resources[resource] += STARTING_RESOURCES_PER_TYPE;
    }
    events.push(
      appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
        playerId: player.id,
        resources: { ...gained },
        source: "STARTING_RESOURCES",
      }),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: player.id,
          resources: { ...player.resources },
          reason: "STARTING_RESOURCES",
        },
        "PLAYER",
        player.id,
      ),
    );
  }

  return events;
}

function applyPlaceInitialSettlement(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  vertex.building = { playerId, type: "settlement" };
  player.settlements.push(vertexId);
  state.setup.lastSettlementVertexId = vertexId;
  state.setup.step = SETUP_STEPS.ROAD;

  const events = [
    appendEvent(state, EVENT_TYPES.SETTLEMENT_PLACED, {
      playerId,
      vertexId,
      isInitial: true,
      round: state.phase === GAME_PHASES.SETUP_ROUND_2 ? 2 : 1,
      victoryPoints: calculatePublicVictoryPoints(state, playerId),
    }),
  ];

  return events;
}

function applyPlaceInitialRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);
  state.setup.lastSettlementVertexId = null;
  state.setup.index += 1;
  state.setup.step = SETUP_STEPS.SETTLEMENT;

  const events = [
    appendEvent(state, EVENT_TYPES.ROAD_PLACED, {
      playerId,
      edgeId,
      isInitial: true,
    }),
  ];

  if (state.setup.index >= state.setup.order.length) {
    const previousPhase = state.phase;
    state.phase = GAME_PHASES.AWAITING_ROLL;
    state.currentPlayerId = 0;
    state.turnNumber = 1;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: previousPhase,
        to: GAME_PHASES.AWAITING_ROLL,
      }),
      appendEvent(state, EVENT_TYPES.SETUP_COMPLETED, {
        startingPlayerId: state.currentPlayerId,
      }),
      appendEvent(state, EVENT_TYPES.TURN_STARTED, {
        playerId: state.currentPlayerId,
        turnNumber: state.turnNumber,
      }),
    );
    return events;
  }

  if (state.setup.index === state.players.length) {
    state.phase = GAME_PHASES.SETUP_ROUND_2;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.SETUP_ROUND_1,
        to: GAME_PHASES.SETUP_ROUND_2,
      }),
    );
  }

  state.currentPlayerId = state.setup.order[state.setup.index];
  events.push(
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: state.currentPlayerId,
      setupIndex: state.setup.index,
    }),
  );
  return events;
}

function valid() {
  return { ok: true };
}

function invalid(code, message, details = null) {
  return { ok: false, code, message, details };
}

function rejected(state, envelope, code, message, details = null) {
  return {
    state,
    result: {
      commandId: envelope.commandId,
      accepted: false,
      version: state.version,
      events: [],
      error: { code, message, details },
    },
  };
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

exports["SETUP_COMMANDS"] = SETUP_COMMANDS;
exports["BUILD_COMMANDS"] = BUILD_COMMANDS;
exports["dispatchCommand"] = dispatchCommand;
exports["createCommandEnvelope"] = createCommandEnvelope;
exports["createDefaultPlayers"] = createDefaultPlayers;
exports["createGame"] = createGame;
exports["validateCommand"] = validateCommand;
exports["getValidCommands"] = getValidCommands;
},
"src/core/awards.js": function(module, exports, __require) {
function calculateLongestRoadLength (board, playerId) {
  const playerEdges = board.edges.filter((edge) => edge.road?.playerId === playerId);
  if (playerEdges.length === 0) return 0;

  const playerEdgeIds = new Set(playerEdges.map((edge) => edge.id));
  const startingVertices = new Set(
    playerEdges.flatMap((edge) => [edge.v1, edge.v2]),
  );
  let longest = 0;

  for (const vertexId of startingVertices) {
    const vertex = board.vertices[vertexId];
    if (vertex.building && vertex.building.playerId !== playerId) continue;
    walk(vertexId, new Set([vertexId]), new Set(), 0);
  }

  return longest;

  function walk(vertexId, visitedVertices, usedEdges, length) {
    const vertex = board.vertices[vertexId];
    if (vertex.building && vertex.building.playerId !== playerId) return;

    for (const edgeId of vertex.edgeIds) {
      if (!playerEdgeIds.has(edgeId) || usedEdges.has(edgeId)) continue;

      const edge = board.edges[edgeId];
      const nextVertexId = edge.v1 === vertexId ? edge.v2 : edge.v1;
      if (visitedVertices.has(nextVertexId)) continue;
      const nextVertex = board.vertices[nextVertexId];
      if (nextVertex.building && nextVertex.building.playerId !== playerId) continue;

      const nextLength = length + 1;
      longest = Math.max(longest, nextLength);
      visitedVertices.add(nextVertexId);
      usedEdges.add(edgeId);
      walk(nextVertexId, visitedVertices, usedEdges, nextLength);
      usedEdges.delete(edgeId);
      visitedVertices.delete(nextVertexId);
    }
  }
}

exports["calculateLongestRoadLength"] = calculateLongestRoadLength;
},
"src/core/events.js": function(module, exports, __require) {
function appendEvent (
  state,
  type,
  payload = {},
  visibility = "PUBLIC",
  recipientPlayerId = null,
) {
  const event = {
    eventId: `event-${state.version}-${state.eventSequence}`,
    gameId: state.gameId,
    version: state.version,
    sequence: state.eventSequence,
    type,
    visibility,
    recipientPlayerId,
    payload,
  };
  state.eventSequence += 1;
  state.eventLog.push(event);
  if (state.eventLog.length > 300) state.eventLog.shift();
  return event;
}

exports["appendEvent"] = appendEvent;
},
"src/core/state.js": function(module, exports, __require) {
const { BANK_PER_RESOURCE: BANK_PER_RESOURCE, DEVELOPMENT_CARD_TYPES: DEVELOPMENT_CARD_TYPES, GAME_PHASES: GAME_PHASES, PLAYER_COLORS: PLAYER_COLORS, RESOURCES: RESOURCES } = __require("src/core/constants.js");
const { hashSeed: hashSeed } = __require("src/core/rng.js");

function createResourcePool (amount = 0) {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, amount]));
}

function createLobbyState ({
  players,
  seed = Date.now(),
  gameId = `game-${Date.now().toString(36)}`,
}) {
  return {
    gameId,
    version: 0,
    phase: GAME_PHASES.LOBBY,
    seed: String(seed),
    rngState: hashSeed(seed),
    board: null,
    players: players.map((player, index) => ({
      id: index,
      name: player.name || `Player ${index + 1}`,
      isBot: Boolean(player.isBot),
      difficulty: player.difficulty || "medium",
      color: player.color || PLAYER_COLORS[index],
      resources: createResourcePool(),
      settlements: [],
      cities: [],
      roads: [],
      knights: 0,
      developmentCards: [],
      newDevelopmentCards: [],
      developmentCardPlayedThisTurn: false,
      knightsPlayed: 0,
    })),
    currentPlayerId: null,
    turnNumber: 0,
    turn: {
      hasRolled: false,
      dice: null,
      production: [],
    },
    pendingAction: null,
    trade: null,
    developmentDeck: [],
    developmentCardSequence: 0,
    awards: {
      longestRoad: null,
      largestArmy: null,
    },
    bank: createResourcePool(BANK_PER_RESOURCE),
    setup: {
      order: [],
      index: 0,
      step: null,
      lastSettlementVertexId: null,
    },
    robberHexId: null,
    winnerId: null,
    eventSequence: 0,
    eventLog: [],
  };
}

function createSetupOrder (playerCount) {
  const forward = Array.from({ length: playerCount }, (_, index) => index);
  const backward = [...forward].reverse();
  return [...forward, ...backward];
}

function calculateVictoryPoints (state, playerId) {
  const player = state.players[playerId];
  if (!player) return 0;
  const developmentPoints = player.developmentCards.filter(
    (card) => card.type === DEVELOPMENT_CARD_TYPES.VICTORY_POINT,
  ).length;
  const awardPoints =
    (state.awards.longestRoad === playerId ? 2 : 0) +
    (state.awards.largestArmy === playerId ? 2 : 0);
  return player.settlements.length + player.cities.length * 2 + developmentPoints + awardPoints;
}

function calculatePublicVictoryPoints (state, playerId) {
  const player = state.players[playerId];
  if (!player) return 0;
  const revealedDevelopmentPoints = player.developmentCards.filter(
    (card) =>
      card.type === DEVELOPMENT_CARD_TYPES.VICTORY_POINT && card.revealed,
  ).length;
  const awardPoints =
    (state.awards.longestRoad === playerId ? 2 : 0) +
    (state.awards.largestArmy === playerId ? 2 : 0);
  return (
    player.settlements.length +
    player.cities.length * 2 +
    revealedDevelopmentPoints +
    awardPoints
  );
}

exports["createResourcePool"] = createResourcePool;
exports["createLobbyState"] = createLobbyState;
exports["createSetupOrder"] = createSetupOrder;
exports["calculateVictoryPoints"] = calculateVictoryPoints;
exports["calculatePublicVictoryPoints"] = calculatePublicVictoryPoints;
},
"src/core/projection.js": function(module, exports, __require) {
const { getValidCommands: getValidCommands } = __require("src/core/engine.js");
const { calculatePublicVictoryPoints: calculatePublicVictoryPoints, calculateVictoryPoints: calculateVictoryPoints } = __require("src/core/state.js");

function projectPlayerView (state, viewerId) {
  return {
    gameId: state.gameId,
    version: state.version,
    phase: state.phase,
    seed: state.seed,
    viewerId,
    currentPlayerId: state.currentPlayerId,
    turnNumber: state.turnNumber,
    turn: structuredClone(state.turn),
    setup: structuredClone(state.setup),
    board: state.board,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isBot: player.isBot,
      difficulty: player.difficulty,
      resources: player.id === viewerId ? { ...player.resources } : null,
      resourceCount: Object.values(player.resources).reduce(
        (total, amount) => total + amount,
        0,
      ),
      developmentCards:
        player.id === viewerId ? structuredClone(player.developmentCards) : null,
      developmentCardCount: player.developmentCards.length,
      newDevelopmentCardIds:
        player.id === viewerId ? [...player.newDevelopmentCards] : null,
      developmentCardPlayedThisTurn:
        player.id === viewerId ? player.developmentCardPlayedThisTurn : null,
      knightsPlayed: player.knightsPlayed,
      revealedVictoryPoints: player.developmentCards.filter(
        (card) => card.type === "victoryPoint" && card.revealed,
      ).length,
      victoryPoints:
        player.id === viewerId
          ? calculateVictoryPoints(state, player.id)
          : calculatePublicVictoryPoints(state, player.id),
      settlements: [...player.settlements],
      cities: [...player.cities],
      roads: [...player.roads],
    })),
    pendingAction: projectPendingAction(state.pendingAction, viewerId),
    trade: structuredClone(state.trade),
    developmentDeckCount: state.developmentDeck.length,
    awards: structuredClone(state.awards),
    bank: { ...state.bank },
    robberHexId: state.robberHexId,
    validCommands: getValidCommands(state, viewerId),
    eventLog: state.eventLog
      .filter(
        (event) =>
          event.visibility === "PUBLIC" ||
          (event.visibility === "PLAYER" && event.recipientPlayerId === viewerId),
      )
      .slice(-80)
      .map((event) => structuredClone(event)),
    winnerId: state.winnerId,
  };
}

function projectSpectatorView (state) {
  return {
    gameId: state.gameId,
    version: state.version,
    phase: state.phase,
    seed: state.seed,
    viewerType: "SPECTATOR",
    viewerId: null,
    currentPlayerId: state.currentPlayerId,
    turnNumber: state.turnNumber,
    turn: structuredClone(state.turn),
    setup: structuredClone(state.setup),
    board: state.board,
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      isBot: player.isBot,
      difficulty: player.difficulty,
      resources: null,
      resourceCount: Object.values(player.resources).reduce(
        (total, amount) => total + amount,
        0,
      ),
      developmentCards: null,
      developmentCardCount: player.developmentCards.length,
      newDevelopmentCardIds: null,
      developmentCardPlayedThisTurn: null,
      knightsPlayed: player.knightsPlayed,
      revealedVictoryPoints: player.developmentCards.filter(
        (card) => card.type === "victoryPoint" && card.revealed,
      ).length,
      victoryPoints: calculatePublicVictoryPoints(state, player.id),
      settlements: [...player.settlements],
      cities: [...player.cities],
      roads: [...player.roads],
    })),
    pendingAction: structuredClone(state.pendingAction),
    trade: structuredClone(state.trade),
    developmentDeckCount: state.developmentDeck.length,
    awards: structuredClone(state.awards),
    bank: { ...state.bank },
    robberHexId: state.robberHexId,
    validCommands: [],
    eventLog: state.eventLog
      .filter((event) => event.visibility === "PUBLIC")
      .slice(-80)
      .map((event) => structuredClone(event)),
    winnerId: state.winnerId,
  };
}

function projectPendingAction(pendingAction, viewerId) {
  if (!pendingAction) return null;

  const projected = structuredClone(pendingAction);
  if (projected.type === "DISCARD") {
    projected.required = projected.requiredByPlayer[viewerId] || 0;
  }
  return projected;
}

exports["projectPlayerView"] = projectPlayerView;
exports["projectSpectatorView"] = projectSpectatorView;
},
"src/network/remote-session.js": function(module, exports, __require) {
const { CLIENT_MESSAGES: CLIENT_MESSAGES, SERVER_MESSAGES: SERVER_MESSAGES, decodeMessage: decodeMessage, encodeMessage: encodeMessage } = __require("src/network/protocol.js");

class RemoteGameSession {
  constructor({
    url,
    socket = null,
    roomId = "default",
    name = "玩家",
    reconnectToken = null,
    guestId = null,
    role = "player",
  }) {
    this.isRemote = true;
    this.url = url;
    this.roomId = roomId;
    this.name = name;
    this.reconnectToken = reconnectToken;
    this.guestId = guestId;
    this.role = role;
    this.socket = socket || new WebSocket(url);
    this.clientId = null;
    this.playerId = null;
    this.room = null;
    this.self = null;
    this.view = null;
    this.state = null;
    this.replayedEvents = [];
    this.listeners = new Set();
    this.closed = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.socket = null;

    // 注入 socket 是为了测试；正常路径自己建连
    if (socket) this.attach(socket);
    else this.open();
  }

  /** 建一条新连接并挂上监听。重连时也走这里。 */
  open() {
    this.attach(new WebSocket(this.url));
  }

  attach(socket) {
    this.socket = socket;
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.send(CLIENT_MESSAGES.JOIN_ROOM, {
        roomId: this.roomId,
        name: this.name,
        reconnectToken: this.reconnectToken,
        guestId: this.guestId,
        role: this.role,
      });
      this.emit({ type: "connected" });
    });
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(decodeMessage(event.data));
    });
    this.socket.addEventListener("close", () => {
      // 主动 close() 不算掉线，不重连
      if (this.closed) {
        this.emit({ type: "disconnected", intentional: true });
        return;
      }
      this.emit({ type: "disconnected" });
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.emit({ type: "connection_error" });
    });
  }

  /** 退避重连：1s / 2s / 4s / 8s，最长 15s，连上后计数归零。 */
  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 15000);
    this.reconnectAttempt += 1;
    this.emit({ type: "reconnecting", attempt: this.reconnectAttempt, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.open();
    }, delay);
  }

  get version() {
    return this.view?.version ?? 0;
  }

  get phase() {
    return this.view?.phase ?? null;
  }

  dispatch(actorId, command, commandId) {
    const id = commandId || createId("command");
    this.send(CLIENT_MESSAGES.SUBMIT_COMMAND, {
      commandId: id,
      expectedVersion: this.version,
      command,
    });
    return {
      commandId: id,
      accepted: true,
      pending: true,
      version: this.version,
      events: [],
      error: null,
    };
  }

  getView() {
    return this.view;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setReady(ready) {
    this.send(CLIENT_MESSAGES.SET_READY, { ready });
  }

  addBot(difficulty = "medium") {
    this.send(CLIENT_MESSAGES.ADD_BOT, { difficulty });
  }

  removeBot(seatId) {
    this.send(CLIENT_MESSAGES.REMOVE_BOT, { seatId });
  }

  updateRoomSettings(settings) {
    this.send(CLIENT_MESSAGES.UPDATE_ROOM_SETTINGS, { settings });
  }

  setRoomPaused(paused) {
    this.send(CLIENT_MESSAGES.SET_ROOM_PAUSED, { paused });
  }

  kickPlayer(seatId) {
    this.send(CLIENT_MESSAGES.KICK_PLAYER, { seatId });
  }

  kickSpectator(spectatorId) {
    this.send(CLIENT_MESSAGES.KICK_SPECTATOR, { spectatorId });
  }

  transferHost(seatId) {
    this.send(CLIENT_MESSAGES.TRANSFER_HOST, { seatId });
  }

  startGame() {
    this.send(CLIENT_MESSAGES.START_GAME);
  }

  requestSync() {
    this.send(CLIENT_MESSAGES.REQUEST_SYNC, { sinceVersion: this.version });
  }

  requestReplay({ roomId = null, gameId = null } = {}) {
    this.send(CLIENT_MESSAGES.REQUEST_REPLAY, { roomId, gameId });
  }

  requestMatchHistory() {
    this.send(CLIENT_MESSAGES.REQUEST_MATCH_HISTORY);
  }

  leaveRoom() {
    this.send(CLIENT_MESSAGES.LEAVE_ROOM);
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }

  send(type, payload = {}) {
    if (this.socket.readyState !== 1) return;
    this.socket.send(encodeMessage(type, payload));
  }

  handleMessage(message) {
    switch (message.type) {
      case SERVER_MESSAGES.CONNECTED:
        this.clientId = message.clientId;
        this.emit({ type: "connected", clientId: this.clientId });
        break;
      case SERVER_MESSAGES.ROOM_STATE:
        this.room = message.room;
        this.self = message.self || this.self;
        if (this.self?.reconnectToken) {
          this.reconnectToken = this.self.reconnectToken;
        }
        this.emit({ type: "room_state", room: this.room, self: this.self });
        break;
      case SERVER_MESSAGES.STATE_SNAPSHOT:
        this.playerId = message.playerId;
        this.room = message.room || this.room;
        this.view = message.view;
        this.state = message.view;
        this.emit({
          type: "snapshot",
          playerId: this.playerId,
          accepted: true,
          version: this.view.version,
          events: [],
          error: null,
        });
        break;
      case SERVER_MESSAGES.EVENTS_REPLAYED:
        this.replayedEvents = message.events || [];
        this.emit({ type: "events_replayed", events: this.replayedEvents });
        break;
      case SERVER_MESSAGES.COMMAND_ACCEPTED:
        this.emit({
          type: "command_accepted",
          commandId: message.commandId,
          accepted: true,
          version: message.version,
          events: [],
          error: null,
        });
        break;
      case SERVER_MESSAGES.COMMAND_REJECTED:
        this.emit({
          type: "command_rejected",
          commandId: message.commandId,
          accepted: false,
          version: message.version,
          events: [],
          error: message.error,
        });
        break;
      default:
        this.emit(message);
    }
  }

  emit(message) {
    for (const listener of this.listeners) listener(message);
  }
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

exports["RemoteGameSession"] = RemoteGameSession;
},
"src/network/protocol.js": function(module, exports, __require) {
const CLIENT_MESSAGES = Object.freeze({
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  SET_READY: "set_ready",
  ADD_BOT: "add_bot",
  REMOVE_BOT: "remove_bot",
  UPDATE_ROOM_SETTINGS: "update_room_settings",
  SET_ROOM_PAUSED: "set_room_paused",
  KICK_PLAYER: "kick_player",
  KICK_SPECTATOR: "kick_spectator",
  TRANSFER_HOST: "transfer_host",
  START_GAME: "start_game",
  SUBMIT_COMMAND: "submit_command",
  REQUEST_SYNC: "request_sync",
  REQUEST_REPLAY: "request_replay",
  REQUEST_MATCH_HISTORY: "request_match_history",
});

const SERVER_MESSAGES = Object.freeze({
  CONNECTED: "connected",
  ROOM_STATE: "room_state",
  GAME_STARTED: "game_started",
  COMMAND_ACCEPTED: "command_accepted",
  COMMAND_REJECTED: "command_rejected",
  GAME_EVENTS: "game_events",
  EVENTS_REPLAYED: "events_replayed",
  STATE_SNAPSHOT: "state_snapshot",
  REPLAY_DATA: "replay_data",
  MATCH_HISTORY: "match_history",
  ERROR: "error",
  PLAYER_DISCONNECTED: "player_disconnected",
  PLAYER_RECONNECTED: "player_reconnected",
  SPECTATOR_JOINED: "spectator_joined",
  SPECTATOR_LEFT: "spectator_left",
  SPECTATOR_KICKED: "spectator_kicked",
  PLAYER_KICKED: "player_kicked",
  ROOM_PAUSED: "room_paused",
  ROOM_RESUMED: "room_resumed",
  BOT_TAKEOVER_STARTED: "bot_takeover_started",
  BOT_TAKEOVER_ENDED: "bot_takeover_ended",
  ROOM_CLOSED: "room_closed",
});

function encodeMessage (type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

function decodeMessage (raw) {
  const message = JSON.parse(String(raw));
  if (!message || typeof message.type !== "string") {
    throw new Error("Message type is required.");
  }
  return message;
}

exports["CLIENT_MESSAGES"] = CLIENT_MESSAGES;
exports["SERVER_MESSAGES"] = SERVER_MESSAGES;
exports["encodeMessage"] = encodeMessage;
exports["decodeMessage"] = decodeMessage;
},
"debug/sound.js": function(module, exports, __require) {
/* 音效层：全部用 WebAudio 现场合成，不依赖任何音频素材文件。

   三条约定：
   1. 浏览器不允许没交互就出声，所以第一次 pointerdown / keydown 才解锁
      AudioContext（unlock()）；iOS 之后还可能再挂起，所以每次交互都顺手 resume。
   2. 每个音都短、轻、干燥，只有一两下；做成旋律会盖过思考。
   3. 同一个音 60ms 内重复直接丢掉，避免连点/连续事件刷成噪音。

   对外只有 play / unlock / isMuted / setMuted，外加一个 log 方便自测。 */

const REPEAT_GAP_MS = 60;
const NOISE_SECONDS = 0.4;

function createSoundLayer ({ storageKey = "catania-sound", volume = 0.5 } = {}) {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let muted = false;
  try {
    muted = localStorage.getItem(storageKey) === "off";
  } catch (error) {
    muted = false;
  }

  const lastPlayedAt = new Map();
  const log = [];
  const recent = [];

  function ensureContext() {
    if (context) return context;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    context = new Ctor();
    master = context.createGain();
    master.gain.value = Math.min(1, Math.max(0, volume));
    master.connect(context.destination);
    return context;
  }

  function unlock() {
    const ctx = ensureContext();
    if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  }

  function noiseSource() {
    if (!noiseBuffer) {
      const length = Math.floor(context.sampleRate * NOISE_SECONDS);
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
    }
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    return source;
  }

  /** 一个短音：三角/正弦为主，可带滑音。 */
  function tone({ at, freq, to = freq, dur, type = "triangle", gain = 0.06, delay = 0 }) {
    const start = at + delay;
    const osc = context.createOscillator();
    const amp = context.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
    }
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(amp).connect(master);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }

  /** 一段带通噪音：木、纸、骰子这些质感主要靠它。 */
  function hiss({ at, dur, freq, q = 1, gain = 0.05, sweepTo = null, delay = 0 }) {
    const start = at + delay;
    const source = noiseSource();
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, start);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, start + dur);
    const amp = context.createGain();
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(gain, start + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter).connect(amp).connect(master);
    source.start(start, Math.random() * 0.2, dur + 0.03);
  }

  const VOICES = {
    /* 按钮：一小下，像指甲磕木头 */
    click: (at) => {
      tone({ at, freq: 1180, to: 760, dur: 0.05, gain: 0.04 });
      hiss({ at, dur: 0.028, freq: 2600, q: 0.8, gain: 0.018 });
    },
    /* 掷骰：三下落桌，间距递减，最后垫一记闷响 */
    dice: (at) => {
      hiss({ at, dur: 0.05, freq: 1700, q: 1.2, gain: 0.07 });
      hiss({ at, dur: 0.045, freq: 1400, q: 1.2, gain: 0.06, delay: 0.07 });
      hiss({ at, dur: 0.05, freq: 1150, q: 1.2, gain: 0.065, delay: 0.13 });
      tone({ at, freq: 150, to: 108, dur: 0.13, type: "sine", gain: 0.05, delay: 0.18 });
    },
    /* 收资源：纸声 + 一记轻亮音 */
    gain: (at) => {
      hiss({ at, dur: 0.12, freq: 3200, q: 0.6, gain: 0.032, sweepTo: 1800 });
      tone({ at, freq: 880, to: 1320, dur: 0.14, type: "sine", gain: 0.045, delay: 0.02 });
    },
    /* 修路：笔刷扫过去 */
    road: (at) => {
      hiss({ at, dur: 0.16, freq: 900, q: 0.9, gain: 0.05, sweepTo: 2400 });
      tone({ at, freq: 320, to: 240, dur: 0.09, gain: 0.032, delay: 0.1 });
    },
    /* 落子：木牌压桌 + 一声轻磕 */
    build: (at) => {
      tone({ at, freq: 132, to: 92, dur: 0.2, type: "sine", gain: 0.085 });
      hiss({ at, dur: 0.07, freq: 700, q: 1.4, gain: 0.045, delay: 0.01 });
      tone({ at, freq: 620, to: 520, dur: 0.09, gain: 0.028, delay: 0.05 });
    },
    /* 强盗：先把棋子蹭到位，再一记闷响落桌，最后留一点低频余韵。
       这里刻意不用锯齿波、也不做大幅下滑 —— 那是电子音的下坠感，
       放在木头和纸上很出戏。全部用正弦 + 噪音，和落子/修路同一套材质。 */
    robber: (at) => {
      hiss({ at, dur: 0.13, freq: 900, q: 1.1, gain: 0.034, sweepTo: 420 });
      tone({ at, freq: 140, to: 88, dur: 0.2, type: "sine", gain: 0.095, delay: 0.09 });
      hiss({ at, dur: 0.045, freq: 620, q: 1.7, gain: 0.036, delay: 0.1 });
      tone({ at, freq: 76, to: 60, dur: 0.3, type: "sine", gain: 0.05, delay: 0.15 });
    },
    open: (at) => hiss({ at, dur: 0.16, freq: 1200, q: 0.5, gain: 0.035, sweepTo: 3400 }),
    close: (at) => hiss({ at, dur: 0.14, freq: 3000, q: 0.5, gain: 0.03, sweepTo: 1100 }),
    /* 轮到我了：两声轻的，一低一高。只为提示，不抢戏 */
    turn: (at) => {
      tone({ at, freq: 392, dur: 0.12, type: "sine", gain: 0.05 });
      tone({ at, freq: 588, dur: 0.16, type: "sine", gain: 0.045, delay: 0.11 });
    },
    /* 一块地亮起来时的一声轻点：比按钮还轻，多块就是一小串 */
    ping: (at) => {
      tone({ at, freq: 664, to: 700, dur: 0.1, type: "sine", gain: 0.028 });
    },
    /* 报价单上桌：纸滑过去，末尾轻轻压一下 */
    paper: (at) => {
      hiss({ at, dur: 0.15, freq: 2600, q: 0.6, gain: 0.03, sweepTo: 1500 });
      tone({ at, freq: 300, to: 236, dur: 0.1, type: "sine", gain: 0.03, delay: 0.13 });
    },
    /* 回应盖戳：木槌压一下，后面那声才是结论。上行=接受，下行=拒绝。
       和 robber 一样刻意避开锯齿/方波，保持木头和纸的材质。 */
    "stamp-yes": (at) => {
      tone({ at, freq: 152, to: 112, dur: 0.12, type: "sine", gain: 0.062 });
      hiss({ at, dur: 0.05, freq: 900, q: 1.4, gain: 0.03, delay: 0.01 });
      tone({ at, freq: 620, to: 880, dur: 0.16, type: "sine", gain: 0.042, delay: 0.06 });
    },
    "stamp-no": (at) => {
      tone({ at, freq: 152, to: 112, dur: 0.12, type: "sine", gain: 0.062 });
      hiss({ at, dur: 0.05, freq: 800, q: 1.4, gain: 0.03, delay: 0.01 });
      tone({ at, freq: 318, to: 238, dur: 0.18, type: "sine", gain: 0.04, delay: 0.06 });
    },
    /* 成交：货过手。两声轻快上行，比结算音短一截、低一档，免得抢戏 */
    deal: (at) => {
      hiss({ at, dur: 0.09, freq: 3000, q: 0.7, gain: 0.026, sweepTo: 2200 });
      tone({ at, freq: 494, dur: 0.12, type: "sine", gain: 0.045, delay: 0.02 });
      tone({ at, freq: 659, dur: 0.16, type: "sine", gain: 0.04, delay: 0.11 });
    },
    /* 银行/港口兑换：两下轻磕加一记翻纸，不做"硬币叮当"那种街机音 */
    coin: (at) => {
      tone({ at, freq: 1180, to: 980, dur: 0.07, type: "sine", gain: 0.03 });
      hiss({ at, dur: 0.09, freq: 2400, q: 0.8, gain: 0.022, delay: 0.04 });
      tone({ at, freq: 1480, to: 1240, dur: 0.08, type: "sine", gain: 0.026, delay: 0.07 });
    },
    /* 操作被拒：两声短闷音。用三角波而不是方波 —— 方波是"8 位提示音"，
       在这种纸上木头里太跳；三角波沉一点，仍然明确是"不行"。 */
    error: (at) => {
      tone({ at, freq: 176, to: 150, dur: 0.1, gain: 0.036 });
      tone({ at, freq: 150, to: 128, dur: 0.12, gain: 0.036, delay: 0.12 });
    },
    /* 结算：三音上行 */
    win: (at) => {
      [523, 659, 784].forEach((freq, index) =>
        tone({ at, freq, dur: 0.22, type: "sine", gain: 0.055, delay: index * 0.13 }),
      );
    },
  };

  function play(name) {
    const voice = VOICES[name];
    if (!voice) return;
    const entry = { name, at: Date.now(), played: false };
    log.push(entry);
    if (log.length > 40) log.shift();
    if (muted) return;

    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const now = Date.now();
    if (now - (lastPlayedAt.get(name) || 0) < REPEAT_GAP_MS) return;
    lastPlayedAt.set(name, now);

    try {
      voice(ctx.currentTime + 0.001);
      entry.played = true;
      /* 和 lastOnlineMessage 一个路子：留个可观测的落点，方便在页面上核对音效有没有发出去。
         用滚动串而不是只记最后一个 —— 一次交互常常连着两个音（按钮 click + 弹窗 open）。 */
      recent.push(name);
      if (recent.length > 8) recent.shift();
      document.body.dataset.soundLog = recent.join(",");
    } catch (error) {
      /* 音效出问题不该影响对局，静默吞掉 */
      entry.failed = String(error?.message || error);
    }
  }

  return {
    play,
    unlock,
    isMuted: () => muted,
    setMuted(next) {
      muted = Boolean(next);
      try {
        localStorage.setItem(storageKey, muted ? "off" : "on");
      } catch (error) {
        /* 存不了就算了，本次会话内仍然生效 */
      }
    },
    get state() {
      return context ? context.state : "none";
    },
    get log() {
      return log;
    },
  };
}

exports["createSoundLayer"] = createSoundLayer;
}
  };
  const __cache = {};
  function __require(id) {
    if (__cache[id]) return __cache[id].exports;
    const module = { exports: {} };
    __cache[id] = module;
    __modules[id](module, module.exports, __require);
    return module.exports;
  }
  __require("debug/app.js");
})();
