import test from "node:test";
import assert from "node:assert/strict";

import { chooseBotCommand } from "../src/bots/heuristic-bot.js";
import {
  COMMAND_TYPES,
  GAME_PHASES,
  RESOURCES,
} from "../src/core/constants.js";
import { LocalGameSession } from "../src/core/session.js";
import { RoomManager } from "../src/network/room-manager.js";

function botPlayers(count = 4, difficulty = "medium") {
  return Array.from({ length: count }, (_, index) => ({
    name: `Bot ${index + 1}`,
    isBot: true,
    difficulty,
  }));
}

function tradeTestBoard() {
  return {
    edges: [
      { id: 0, v1: 0, v2: 1, road: { playerId: 0 }, hexIds: [] },
      { id: 1, v1: 1, v2: 2, road: null, hexIds: [] },
    ],
    vertices: [
      {
        id: 0,
        edgeIds: [0],
        adjacentVertexIds: [1],
        building: { playerId: 0, type: "settlement" },
      },
      {
        id: 1,
        edgeIds: [0, 1],
        adjacentVertexIds: [0, 2],
        building: null,
      },
      {
        id: 2,
        edgeIds: [1],
        adjacentVertexIds: [1],
        building: null,
      },
    ],
  };
}

function tradeTestView({ resources = {}, validCommands, eventLog = [] }) {
  const me = {
    id: 0,
    name: "Bot 1",
    isBot: true,
    difficulty: "medium",
    resources: Object.fromEntries(
      RESOURCES.map((resource) => [resource, resources[resource] || 0]),
    ),
    resourceCount: Object.values(resources).reduce(
      (total, amount) => total + amount,
      0,
    ),
    developmentCards: [],
    newDevelopmentCardIds: [],
    developmentCardPlayedThisTurn: false,
    knightsPlayed: 0,
    revealedVictoryPoints: 0,
    victoryPoints: 0,
    settlements: [0],
    cities: [],
    roads: [0],
  };
  const opponents = [1, 2, 3].map((id) => ({
    id,
    name: `Bot ${id + 1}`,
    isBot: true,
    difficulty: "medium",
    resources: null,
    resourceCount: 0,
    developmentCards: null,
    developmentCardCount: 0,
    newDevelopmentCardIds: null,
    developmentCardPlayedThisTurn: null,
    knightsPlayed: 0,
    revealedVictoryPoints: 0,
    victoryPoints: 0,
    settlements: [],
    cities: [],
    roads: [],
  }));

  return {
    viewerId: 0,
    phase: GAME_PHASES.TURN_ACTIONS,
    players: [me, ...opponents],
    board: tradeTestBoard(),
    trade: null,
    eventLog,
    validCommands,
  };
}

function turnStarted(sequence, playerId) {
  return {
    sequence,
    type: "TURN_STARTED",
    payload: { playerId },
  };
}

function tradeCancelled(
  sequence,
  {
    offer,
    request,
    targetPlayerIds = [1, 2, 3],
    responses = { 1: "REJECTED", 2: "REJECTED", 3: "REJECTED" },
  },
) {
  return {
    sequence,
    type: "TRADE_CANCELLED",
    payload: {
      playerId: 0,
      offer,
      request,
      targetPlayerIds,
      responses,
    },
  };
}

function actorForSession(session) {
  if (session.state.trade) {
    const unresponded = session.state.trade.targetPlayerIds.find(
      (playerId) => !session.state.trade.responses[playerId],
    );
    if (unresponded !== undefined) return unresponded;
    return session.state.trade.fromPlayerId;
  }
  if (session.phase === GAME_PHASES.AWAITING_DISCARD) {
    return Number(
      Object.keys(session.state.pendingAction?.requiredByPlayer || {})[0],
    );
  }
  return session.state.currentPlayerId;
}

function totalResourceCards(state) {
  const playerCards = state.players.reduce(
    (total, player) =>
      total +
      Object.values(player.resources).reduce(
        (playerTotal, amount) => playerTotal + amount,
        0,
      ),
    0,
  );
  const bankCards = Object.values(state.bank).reduce(
    (total, amount) => total + amount,
    0,
  );
  return playerCards + bankCards;
}

test("heuristic AI chooses a valid setup command", () => {
  const session = new LocalGameSession({
    gameId: "ai-setup",
    seed: "ai-setup",
    players: botPlayers(),
  });
  session.start(0);

  const actorId = actorForSession(session);
  const view = session.getView(actorId);
  const command = chooseBotCommand(view, "hard", () => 0);

  assert.ok(command);
  assert.ok(
    view.validCommands.some(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(command),
    ),
  );
});

test("heuristic AI can play many turns without illegal commands", () => {
  const session = new LocalGameSession({
    gameId: "ai-full-flow",
    seed: "ai-full-flow",
    players: botPlayers(),
  });
  session.start(0);

  let steps = 0;
  while (session.phase !== GAME_PHASES.GAME_OVER && steps < 260) {
    const actorId = actorForSession(session);
    const view = session.getView(actorId);
    const command = chooseBotCommand(view, "medium", () => 0);
    assert.ok(command, `No AI command at step ${steps}`);
    const result = session.dispatch(actorId, command);
    assert.equal(result.accepted, true, result.error?.message);
    steps += 1;
  }

  assert.ok(steps > 20);
  assert.ok(
    session.phase === GAME_PHASES.GAME_OVER ||
      session.state.turnNumber >= 2,
  );
});

test("a complete bot game conserves all 95 resource cards", () => {
  const session = new LocalGameSession({
    gameId: "ai-resource-conservation",
    seed: "ai-resource-conservation",
    players: botPlayers(4, "hard"),
  });
  session.start(0);

  const expectedTotal = totalResourceCards(session.state);
  assert.equal(expectedTotal, 95);

  let steps = 0;
  while (session.phase !== GAME_PHASES.GAME_OVER && steps < 3000) {
    const actorId = actorForSession(session);
    const command = chooseBotCommand(session.getView(actorId), "hard", () => 0);
    assert.ok(command, `No AI command at step ${steps}`);
    const result = session.dispatch(actorId, command);
    assert.equal(result.accepted, true, result.error?.message);
    assert.equal(totalResourceCards(session.state), expectedTotal);
    steps += 1;
  }

  assert.equal(session.phase, GAME_PHASES.GAME_OVER);
  assert.equal(totalResourceCards(session.state), expectedTotal);
});

test("hard AI is deterministic for the same view", () => {
  const session = new LocalGameSession({
    gameId: "ai-deterministic",
    seed: "ai-deterministic",
    players: botPlayers(),
  });
  session.start(0);
  const actorId = actorForSession(session);
  const view = session.getView(actorId);

  const first = chooseBotCommand(view, "hard", () => 0);
  const second = chooseBotCommand(view, "hard", () => 0);
  assert.deepEqual(first, second);
});

test("room manager stores the selected bot difficulty", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const socket = { send() {} };
  manager.connect("host", (message) => socket.send(message));
  manager.joinRoom("host", { roomId: "ai-room", name: "Host" });
  manager.addBot("host", "hard");

  const room = manager.rooms.get("ai-room");
  assert.equal(room.seats[1].difficulty, "hard");
  assert.equal(manager.publicRoom(room).seats[1].difficulty, "hard");

  manager.destroy();
});

test("AI creator cancels a trade after every target rejects", () => {
  const session = new LocalGameSession({
    gameId: "ai-trade-finish",
    seed: "ai-trade-finish",
    players: botPlayers(),
  });
  session.start(0);

  let steps = 0;
  while (session.phase !== GAME_PHASES.AWAITING_ROLL && steps < 100) {
    const actorId = actorForSession(session);
    const command = chooseBotCommand(session.getView(actorId), "medium", () => 0);
    session.dispatch(actorId, command);
    steps += 1;
  }

  session.dispatch(0, { type: "ROLL_DICE" });
  session.state.players[0].resources.wheat = 1;
  session.dispatch(0, {
    type: "CREATE_TRADE",
    offer: { wheat: 1 },
    request: { brick: 1 },
    targetPlayerIds: [1, 2, 3],
  });
  session.dispatch(1, { type: "RESPOND_TO_TRADE", accepted: false });
  session.dispatch(2, { type: "RESPOND_TO_TRADE", accepted: false });
  session.dispatch(3, { type: "RESPOND_TO_TRADE", accepted: false });

  const command = chooseBotCommand(session.getView(0), "medium", () => 0);
  assert.equal(command.type, "CANCEL_TRADE");
  session.dispatch(0, command);

  const nextCommand = chooseBotCommand(session.getView(0), "medium", () => 0);
  const repeatsRejectedTrade =
    nextCommand.type === "CREATE_TRADE" &&
    JSON.stringify(nextCommand.offer) === JSON.stringify({ wheat: 1 }) &&
    JSON.stringify(nextCommand.request) === JSON.stringify({ brick: 1 });
  assert.equal(repeatsRejectedTrade, false);
});

test("medium AI initiates at most one player trade per turn", () => {
  const tradeCommand = {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { sheep: 1 },
    request: { brick: 1 },
    targetPlayerIds: [1, 2, 3],
  };
  const view = tradeTestView({
    resources: { wood: 1, sheep: 1 },
    validCommands: [
      tradeCommand,
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [turnStarted(1, 0)],
  });

  assert.equal(chooseBotCommand(view, "medium", () => 1).type, COMMAND_TYPES.CREATE_TRADE);

  view.eventLog.push({
    sequence: 2,
    type: "TRADE_CREATED",
    payload: {
      fromPlayerId: 0,
      offer: tradeCommand.offer,
      request: tradeCommand.request,
    },
  });
  assert.notEqual(
    chooseBotCommand(view, "medium", () => 1).type,
    COMMAND_TYPES.CREATE_TRADE,
  );
});

test("easy AI does not proactively create player trades", () => {
  const view = tradeTestView({
    resources: { wood: 1, sheep: 1 },
    validCommands: [
      {
        type: COMMAND_TYPES.CREATE_TRADE,
        offer: { sheep: 1 },
        request: { brick: 1 },
        targetPlayerIds: [1, 2, 3],
      },
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [turnStarted(1, 0)],
  });

  assert.equal(chooseBotCommand(view, "easy", () => 1).type, COMMAND_TYPES.END_TURN);
});

test("AI prefers a bank trade that enables the same immediate build", () => {
  const view = tradeTestView({
    resources: { wood: 5, sheep: 1 },
    validCommands: [
      {
        type: COMMAND_TYPES.TRADE_WITH_BANK,
        giveResource: "wood",
        giveAmount: 4,
        receiveResource: "brick",
        receiveAmount: 1,
      },
      {
        type: COMMAND_TYPES.CREATE_TRADE,
        offer: { sheep: 1 },
        request: { brick: 1 },
        targetPlayerIds: [1, 2, 3],
      },
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [turnStarted(1, 0)],
  });

  assert.equal(
    chooseBotCommand(view, "hard", () => 1).type,
    COMMAND_TYPES.TRADE_WITH_BANK,
  );
});

test("AI only trades when the exchange unlocks an immediate build", () => {
  const view = tradeTestView({
    resources: { wood: 1, brick: 1, sheep: 1 },
    validCommands: [
      {
        type: COMMAND_TYPES.CREATE_TRADE,
        offer: { sheep: 1 },
        request: { ore: 1 },
        targetPlayerIds: [1, 2, 3],
      },
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [turnStarted(1, 0)],
  });

  assert.equal(chooseBotCommand(view, "hard", () => 1).type, COMMAND_TYPES.END_TURN);
});

test("AI cools down an identical rejected quote", () => {
  const view = tradeTestView({
    resources: { wood: 1, sheep: 1 },
    validCommands: [
      {
        type: COMMAND_TYPES.CREATE_TRADE,
        offer: { sheep: 1 },
        request: { brick: 1 },
        targetPlayerIds: [1, 2, 3],
      },
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [
      turnStarted(1, 0),
      tradeCancelled(2, {
        offer: { sheep: 1 },
        request: { brick: 1 },
      }),
      turnStarted(3, 1),
    ],
  });

  assert.equal(chooseBotCommand(view, "hard", () => 1).type, COMMAND_TYPES.END_TURN);
});

test("AI allows one stronger quote escalation, then stops that pair", () => {
  const tradeCommand = {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { sheep: 2 },
    request: { brick: 1 },
    targetPlayerIds: [1, 2, 3],
  };
  const escalationView = tradeTestView({
    resources: { wood: 1, sheep: 2 },
    validCommands: [tradeCommand, { type: COMMAND_TYPES.END_TURN }],
    eventLog: [
      turnStarted(1, 0),
      tradeCancelled(2, {
        offer: { sheep: 1 },
        request: { brick: 1 },
      }),
      turnStarted(3, 1),
    ],
  });
  assert.equal(
    chooseBotCommand(escalationView, "hard", () => 1).type,
    COMMAND_TYPES.CREATE_TRADE,
  );

  escalationView.eventLog.push(
    tradeCancelled(4, {
      offer: { sheep: 2 },
      request: { brick: 1 },
    }),
    turnStarted(5, 0),
  );
  escalationView.validCommands = [
    {
      ...tradeCommand,
      offer: { sheep: 3 },
    },
    { type: COMMAND_TYPES.END_TURN },
  ];
  escalationView.players[0].resources.sheep = 3;

  assert.equal(
    chooseBotCommand(escalationView, "hard", () => 1).type,
    COMMAND_TYPES.END_TURN,
  );
});

test("AI applies a two-turn cooldown to a consecutively rejecting target", () => {
  const view = tradeTestView({
    resources: { wood: 1, sheep: 2 },
    validCommands: [
      {
        type: COMMAND_TYPES.CREATE_TRADE,
        offer: { sheep: 2 },
        request: { brick: 1 },
        targetPlayerIds: [1, 2],
      },
      { type: COMMAND_TYPES.END_TURN },
    ],
    eventLog: [
      turnStarted(1, 0),
      tradeCancelled(2, {
        offer: { wheat: 1 },
        request: { ore: 1 },
        responses: { 1: "REJECTED", 2: "ACCEPTED", 3: "REJECTED" },
      }),
      turnStarted(3, 1),
      tradeCancelled(4, {
        offer: { wood: 1 },
        request: { ore: 1 },
        responses: { 1: "REJECTED", 2: "ACCEPTED", 3: "REJECTED" },
      }),
      turnStarted(5, 0),
    ],
  });

  const command = chooseBotCommand(view, "hard", () => 1);
  assert.equal(command.type, COMMAND_TYPES.CREATE_TRADE);
  assert.deepEqual(command.targetPlayerIds, [2]);
});
