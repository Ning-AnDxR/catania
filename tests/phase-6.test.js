import test from "node:test";
import assert from "node:assert/strict";

import {
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
} from "../src/core/board.js";
import {
  COMMAND_TYPES,
  ERROR_CODES,
  GAME_PHASES,
  RESOURCES,
  SETUP_STEPS,
} from "../src/core/constants.js";
import {
  createCommandEnvelope,
  createDefaultPlayers,
  createGame,
  dispatchCommand,
  getValidCommands,
} from "../src/core/engine.js";
import { nextRandom } from "../src/core/rng.js";

function accepted(state, actorId, command) {
  const result = dispatchCommand(state, createCommandEnvelope(state, actorId, command));
  assert.equal(result.result.accepted, true, result.result.error?.message);
  assert.equal(result.state.version, state.version + 1);
  return result.state;
}

function rejected(state, actorId, command, expectedCode) {
  const result = dispatchCommand(state, createCommandEnvelope(state, actorId, command));
  assert.equal(result.result.accepted, false);
  assert.equal(result.result.error.code, expectedCode);
  assert.equal(result.state, state);
  return result;
}

function setupCommand(state) {
  if (state.setup.step === SETUP_STEPS.SETTLEMENT) {
    return {
      type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
      vertexId: legalInitialSettlementVertices(state.board)[0],
    };
  }
  return {
    type: COMMAND_TYPES.PLACE_INITIAL_ROAD,
    edgeId: legalInitialRoadEdges(state.board, state.setup.lastSettlementVertexId)[0],
  };
}

function predictDice(state) {
  const clone = { rngState: state.rngState };
  const die1 = Math.floor(nextRandom(clone) * 6) + 1;
  const die2 = Math.floor(nextRandom(clone) * 6) + 1;
  return die1 + die2;
}

function startTurn(prefix = "phase-6") {
  for (let index = 0; index < 50; index += 1) {
    let state = accepted(
      createGame({
        gameId: `game-${prefix}-${index}`,
        seed: `${prefix}-${index}`,
        players: createDefaultPlayers(4),
      }),
      0,
      { type: COMMAND_TYPES.START_GAME },
    );
    while (state.phase !== GAME_PHASES.AWAITING_ROLL) {
      state = accepted(state, state.currentPlayerId, setupCommand(state));
    }
    if (predictDice(state) === 7) continue;
    return accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });
  }
  throw new Error("Unable to find a deterministic non-seven roll.");
}

function setResources(state, playerId, overrides) {
  state.players[playerId].resources = Object.fromEntries(
    RESOURCES.map((resource) => [resource, overrides[resource] || 0]),
  );
  return state;
}

test("bank trade uses the best available harbor ratio", () => {
  let state = startTurn("phase-6-bank-ratio");
  state = setResources(state, 0, { wood: 10, brick: 10 });
  const settlementVertexId = state.players[0].settlements[0];
  state.board.vertices[settlementVertexId].harbor = "wood";
  const bankWoodBefore = state.bank.wood;

  state = accepted(state, 0, {
    type: COMMAND_TYPES.TRADE_WITH_BANK,
    giveResource: "wood",
    giveAmount: 2,
    receiveResource: "brick",
    receiveAmount: 1,
  });
  assert.equal(state.players[0].resources.wood, 8);
  assert.equal(state.players[0].resources.brick, 11);
  assert.equal(state.bank.wood, bankWoodBefore + 2);
});

test("generic and default bank ratios are validated", () => {
  let state = startTurn("phase-6-bank-default");
  state = setResources(state, 0, { wood: 10, brick: 10 });
  for (const vertexId of state.players[0].settlements) {
    state.board.vertices[vertexId].harbor = null;
  }

  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.TRADE_WITH_BANK,
      giveResource: "wood",
      giveAmount: 3,
      receiveResource: "brick",
      receiveAmount: 1,
    },
    ERROR_CODES.INVALID_TRADE_RATIO,
  );

  state = accepted(state, 0, {
    type: COMMAND_TYPES.TRADE_WITH_BANK,
    giveResource: "wood",
    giveAmount: 4,
    receiveResource: "brick",
    receiveAmount: 1,
  });
  assert.equal(state.players[0].resources.wood, 6);
  assert.equal(state.players[0].resources.brick, 11);
});

test("an unoccupied harbor does not grant a harbor trade ratio", () => {
  let state = startTurn("phase-6-unoccupied-harbor");
  state = setResources(state, 0, { wood: 4, brick: 0 });
  state.players[0].settlements = [];
  state.players[0].cities = [];
  state.board.vertices[0].harbor = "wood";

  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.TRADE_WITH_BANK,
      giveResource: "wood",
      giveAmount: 2,
      receiveResource: "brick",
      receiveAmount: 1,
    },
    ERROR_CODES.INVALID_TRADE_RATIO,
  );
});

test("bank trade cannot spend resources the player or bank does not have", () => {
  let state = startTurn("phase-6-bank-insufficient");
  state = setResources(state, 0, { wood: 3, brick: 0 });
  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.TRADE_WITH_BANK,
      giveResource: "wood",
      giveAmount: 4,
      receiveResource: "brick",
      receiveAmount: 1,
    },
    ERROR_CODES.INSUFFICIENT_RESOURCES,
  );

  state = setResources(state, 0, { wood: 4 });
  state.bank.brick = 0;
  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.TRADE_WITH_BANK,
      giveResource: "wood",
      giveAmount: 4,
      receiveResource: "brick",
      receiveAmount: 1,
    },
    ERROR_CODES.INSUFFICIENT_RESOURCES,
  );
});

test("player trade only accepts responses from targets and confirms atomically", () => {
  let state = startTurn("phase-6-player-trade");
  state = setResources(state, 0, { wood: 1 });
  state = setResources(state, 1, { ore: 1 });
  state = setResources(state, 2, {});
  state = setResources(state, 3, {});

  state = accepted(state, 0, {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { wood: 1 },
    request: { ore: 1 },
    targetPlayerIds: [1],
  });
  assert.equal(state.trade.fromPlayerId, 0);
  assert.equal(
    getValidCommands(state, 0).some((command) => command.type === "CANCEL_TRADE"),
    false,
  );
  assert.equal(getValidCommands(state, 1).some((command) => command.type === "RESPOND_TO_TRADE"), true);

  rejected(
    state,
    2,
    { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: true },
    ERROR_CODES.NOT_TRADE_TARGET,
  );

  state = accepted(state, 1, { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: true });
  assert.equal(
    getValidCommands(state, 0).some((command) => command.type === "CANCEL_TRADE"),
    true,
  );
  rejected(
    state,
    1,
    { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: true },
    ERROR_CODES.TRADE_ALREADY_RESPONDED,
  );
  state.players[1].resources.ore = 0;
  rejected(
    state,
    0,
    { type: COMMAND_TYPES.CONFIRM_TRADE, partnerId: 1 },
    ERROR_CODES.INSUFFICIENT_RESOURCES,
  );

  state.players[1].resources.ore = 1;
  state = accepted(state, 0, { type: COMMAND_TYPES.CONFIRM_TRADE, partnerId: 1 });
  assert.equal(state.trade, null);
  assert.equal(state.players[0].resources.wood, 0);
  assert.equal(state.players[0].resources.ore, 1);
  assert.equal(state.players[1].resources.wood, 1);
  assert.equal(state.players[1].resources.ore, 0);
});

test("cancel trade leaves both hands and bank unchanged", () => {
  let state = startTurn("phase-6-cancel");
  state = setResources(state, 0, { wood: 1 });
  state = setResources(state, 1, { ore: 1 });
  state = accepted(state, 0, {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { wood: 1 },
    request: { ore: 1 },
    targetPlayerIds: [1],
  });
  const before = {
    wood: state.players[0].resources.wood,
    ore: state.players[1].resources.ore,
    bank: { ...state.bank },
  };

  state = accepted(state, 1, {
    type: COMMAND_TYPES.RESPOND_TO_TRADE,
    accepted: false,
  });
  state = accepted(state, 0, { type: COMMAND_TYPES.CANCEL_TRADE });
  assert.equal(state.trade, null);
  assert.equal(state.players[0].resources.wood, before.wood);
  assert.equal(state.players[1].resources.ore, before.ore);
  assert.deepEqual(state.bank, before.bank);
});

test("trade responses follow seat order and confirm waits for the full round", () => {
  let state = startTurn("phase-6-response-order");
  state = setResources(state, 0, { wood: 1 });
  state = setResources(state, 1, { ore: 1 });
  state = setResources(state, 2, { brick: 1 });
  state = setResources(state, 3, {});
  state = accepted(state, 0, {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { wood: 1 },
    request: { ore: 1 },
    targetPlayerIds: [1, 2],
  });

  rejected(
    state,
    2,
    { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: false },
    ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
  );
  state = accepted(state, 1, {
    type: COMMAND_TYPES.RESPOND_TO_TRADE,
    accepted: true,
  });
  rejected(
    state,
    0,
    { type: COMMAND_TYPES.CONFIRM_TRADE, partnerId: 1 },
    ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
  );
  state = accepted(state, 2, {
    type: COMMAND_TYPES.RESPOND_TO_TRADE,
    accepted: false,
  });
  state = accepted(state, 0, {
    type: COMMAND_TYPES.CONFIRM_TRADE,
    partnerId: 1,
  });

  assert.equal(state.trade, null);
});

test("player id zero can be the first trade responder", () => {
  let state = startTurn("phase-6-zero-responder");
  state = setResources(state, 0, { brick: 1 });
  state = setResources(state, 1, { wheat: 1 });
  state.currentPlayerId = 1;
  state.phase = GAME_PHASES.TURN_ACTIONS;
  state.turn.hasRolled = true;
  state = accepted(state, 1, {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { wheat: 1 },
    request: { brick: 1 },
    targetPlayerIds: [0, 2, 3],
  });

  assert.equal(state.trade.currentResponderPlayerId, 0);
  assert.equal(
    getValidCommands(state, 0).some(
      (command) => command.type === COMMAND_TYPES.RESPOND_TO_TRADE,
    ),
    true,
  );
  assert.equal(getValidCommands(state, 1).length, 0);
});

test("player trade supports multiple cards for one", () => {
  let state = startTurn("phase-6-multi-card-trade");
  state = setResources(state, 0, { wood: 2 });
  state = setResources(state, 1, { ore: 1 });
  state = setResources(state, 2, {});
  state = setResources(state, 3, {});
  const tradeCommand = getValidCommands(state, 0).find(
    (command) =>
      command.type === COMMAND_TYPES.CREATE_TRADE &&
      command.offer.wood === 2 &&
      command.request.ore === 1,
  );
  assert.ok(tradeCommand);

  state = accepted(state, 0, {
    ...tradeCommand,
    targetPlayerIds: [1],
  });
  state = accepted(state, 1, {
    type: COMMAND_TYPES.RESPOND_TO_TRADE,
    accepted: true,
  });
  state = accepted(state, 0, {
    type: COMMAND_TYPES.CONFIRM_TRADE,
    partnerId: 1,
  });

  assert.equal(state.players[0].resources.wood, 0);
  assert.equal(state.players[0].resources.ore, 1);
  assert.equal(state.players[1].resources.wood, 2);
  assert.equal(state.players[1].resources.ore, 0);
});

test("an open trade blocks other turn actions until it is closed", () => {
  let state = startTurn("phase-6-blocked");
  state = setResources(state, 0, { wood: 1 });
  state = setResources(state, 1, { ore: 1 });
  state = accepted(state, 0, {
    type: COMMAND_TYPES.CREATE_TRADE,
    offer: { wood: 1 },
    request: { ore: 1 },
    targetPlayerIds: [1],
  });

  rejected(
    state,
    0,
    { type: COMMAND_TYPES.END_TURN },
    ERROR_CODES.TRADE_ALREADY_OPEN,
  );
});

test("rejects invalid trade offers and over-offering resources", () => {
  let state = startTurn("phase-6-invalid-offer");
  state = setResources(state, 0, { wood: 1 });
  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.CREATE_TRADE,
      offer: { wood: 0 },
      request: { ore: 1 },
      targetPlayerIds: [1],
    },
    ERROR_CODES.INVALID_TRADE,
  );

  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.CREATE_TRADE,
      offer: { wood: 2 },
      request: { ore: 1 },
      targetPlayerIds: [1],
    },
    ERROR_CODES.INSUFFICIENT_RESOURCES,
  );
});
