import test from "node:test";
import assert from "node:assert/strict";

import { chooseRandomCommand } from "../src/bots/random-bot.js";
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
} from "../src/core/engine.js";
import { projectPlayerView } from "../src/core/projection.js";
import { nextRandom } from "../src/core/rng.js";
import { LocalGameSession } from "../src/core/session.js";

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

function completeSetup(seed = "phase-2-test") {
  let state = accepted(
    createGame({
      gameId: `game-${seed}`,
      seed,
      players: createDefaultPlayers(4),
    }),
    0,
    { type: COMMAND_TYPES.START_GAME },
  );

  while (state.phase !== GAME_PHASES.AWAITING_ROLL) {
    state = accepted(state, state.currentPlayerId, setupCommand(state));
  }

  return state;
}

function completeSetupWithNonSevenRoll(prefix = "phase-2-non-seven") {
  for (let index = 0; index < 50; index += 1) {
    const state = completeSetup(`${prefix}-${index}`);
    if (predictDice(state).total !== 7) return state;
  }
  throw new Error("Unable to find a deterministic seed that does not roll seven.");
}

/* 银行断供要的是「这一掷真的有人收成」的图：地形是随机排的，
   第一个非 7 的种子不一定有人在对应点数上占了房，所以得连需求一起挑。 */
function completeSetupWithProducingRoll(prefix = "phase-2-producing") {
  for (let index = 0; index < 50; index += 1) {
    const state = completeSetup(`${prefix}-${index}`);
    const dice = predictDice(state);
    if (dice.total === 7) continue;
    const demand = calculateDemand(state, dice.total);
    if (RESOURCES.some((resource) => demand[resource].total > 0)) return state;
  }
  throw new Error("Unable to find a deterministic seed with a producing roll.");
}

function completeSetupWithStableDice(prefix = "phase-2-stable") {
  for (let index = 0; index < 100; index += 1) {
    const state = completeSetup(`${prefix}-${index}`);
    const clone = { rngState: state.rngState };
    let stable = true;
    for (let roll = 0; roll < 8; roll += 1) {
      const die1 = Math.floor(nextRandom(clone) * 6) + 1;
      const die2 = Math.floor(nextRandom(clone) * 6) + 1;
      if (die1 + die2 === 7) {
        stable = false;
        break;
      }
    }
    if (stable) return state;
  }
  throw new Error("Unable to find a deterministic dice sequence without seven.");
}

function predictDice(state) {
  const clone = { rngState: state.rngState };
  const die1 = Math.floor(nextRandom(clone) * 6) + 1;
  const die2 = Math.floor(nextRandom(clone) * 6) + 1;
  return { die1, die2, total: die1 + die2 };
}

function findRngStateForTotal(total) {
  for (let rngState = 1; rngState < 100_000; rngState += 1) {
    const clone = { rngState };
    const die1 = Math.floor(nextRandom(clone) * 6) + 1;
    const die2 = Math.floor(nextRandom(clone) * 6) + 1;
    if (die1 + die2 === total) return rngState;
  }
  throw new Error(`Unable to find deterministic dice for total ${total}.`);
}

function calculateDemand(state, total) {
  const demand = Object.fromEntries(
    RESOURCES.map((resource) => [resource, { total: 0, hexes: [] }]),
  );

  for (const hex of [...state.board.hexes].sort((first, second) => first.id - second.id)) {
    if (hex.number !== total || !hex.resource || hex.id === state.robberHexId) continue;

    const gains = [];
    for (const vertexId of [...hex.vertexIds].sort((first, second) => first - second)) {
      const building = state.board.vertices[vertexId]?.building;
      if (!building) continue;
      gains.push({
        playerId: building.playerId,
        amount: building.type === "city" ? 2 : 1,
      });
    }

    if (gains.length > 0) {
      gains.sort((first, second) => first.playerId - second.playerId);
      demand[hex.resource].total += gains.reduce((sum, gain) => sum + gain.amount, 0);
      demand[hex.resource].hexes.push({
        hexId: hex.id,
        resource: hex.resource,
        gains,
      });
    }
  }

  return demand;
}

function expectedProduction(state, total) {
  if (total === 7) return [];
  const demand = calculateDemand(state, total);
  const production = [];

  for (const resource of RESOURCES) {
    if (demand[resource].total === 0) continue;
    if (state.bank[resource] < demand[resource].total) continue;
    production.push(...demand[resource].hexes);
  }

  return production;
}

function resourceTotals(state) {
  const totals = Object.fromEntries(RESOURCES.map((resource) => [resource, 0]));
  for (const player of state.players) {
    for (const resource of RESOURCES) totals[resource] += player.resources[resource];
  }
  for (const resource of RESOURCES) totals[resource] += state.bank[resource];
  return totals;
}

test("ROLL_DICE records deterministic dice and enters TURN_ACTIONS", () => {
  let state = completeSetup("phase-2-roll");
  const expectedDice = predictDice(state);

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(state.turn.hasRolled, true);
  assert.deepEqual(state.turn.dice, expectedDice);
  assert.ok(state.eventLog.some((event) => event.type === "DICE_ROLLED"));
  assert.ok(state.eventLog.some((event) => event.type === "PHASE_CHANGED"));
});

test("rejects rolling out of turn and rolling twice in the same turn", () => {
  let state = completeSetup("phase-2-roll-validation");

  rejected(
    state,
    1,
    { type: COMMAND_TYPES.ROLL_DICE },
    ERROR_CODES.NOT_YOUR_TURN,
  );

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });
  rejected(
    state,
    state.currentPlayerId,
    { type: COMMAND_TYPES.ROLL_DICE },
    ERROR_CODES.ALREADY_ROLLED,
  );
});

test("resource production is deterministic and conserves bank plus player resources", () => {
  let state = completeSetup("phase-2-production");
  const dice = predictDice(state);
  const expected = expectedProduction(state, dice.total);
  const totalsBefore = resourceTotals(state);

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });

  assert.deepEqual(state.turn.production, expected);
  assert.deepEqual(resourceTotals(state), totalsBefore);
});

test("a city receives two resources from a producing hex", () => {
  let state = completeSetupWithNonSevenRoll("phase-2-city");
  const dice = predictDice(state);
  const targetHex = state.board.hexes.find(
    (hex) => hex.number === dice.total && hex.resource && hex.id !== state.robberHexId,
  );
  assert.ok(targetHex);

  const cityVertexId = targetHex.vertexIds.find(
    (vertexId) => state.board.vertices[vertexId].building === null,
  );
  assert.notEqual(cityVertexId, undefined);
  state.board.vertices[cityVertexId].building = { playerId: 0, type: "city" };
  state.bank[targetHex.resource] = 19;

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });

  const entry = state.turn.production.find((item) => item.hexId === targetHex.id);
  assert.ok(entry);
  assert.ok(entry.gains.some((gain) => gain.playerId === 0 && gain.amount === 2));
});

test("settlements and cities built beside an 8 produce on the next 8 roll", () => {
  let state = completeSetup("phase-2-built-eight");
  const targetHex = state.board.hexes.find(
    (hex) => hex.number === 8 && hex.resource && hex.id !== state.robberHexId,
  );
  assert.ok(targetHex);

  const vertexId = targetHex.vertexIds.find((candidateId) => {
    const vertex = state.board.vertices[candidateId];
    return !vertex.building;
  });
  assert.notEqual(vertexId, undefined);

  const vertex = state.board.vertices[vertexId];
  for (const adjacentId of vertex.adjacentVertexIds) {
    state.board.vertices[adjacentId].building = null;
  }
  state.board.edges[vertex.edgeIds[0]].road = { playerId: 0 };
  state.players[0].resources = {
    wood: 1,
    brick: 1,
    sheep: 1,
    wheat: 1,
    ore: 3,
  };
  state.phase = GAME_PHASES.TURN_ACTIONS;
  state.currentPlayerId = 0;
  state.turn.hasRolled = true;
  state = accepted(state, 0, {
    type: COMMAND_TYPES.BUILD_SETTLEMENT,
    vertexId,
  });

  const settlementBefore = state.players[0].resources[targetHex.resource];
  state.phase = GAME_PHASES.AWAITING_ROLL;
  state.turn.hasRolled = false;
  state.rngState = findRngStateForTotal(8);
  state = accepted(state, 0, { type: COMMAND_TYPES.ROLL_DICE });
  assert.equal(
    state.players[0].resources[targetHex.resource],
    settlementBefore + 1,
  );

  state.phase = GAME_PHASES.TURN_ACTIONS;
  state.turn.hasRolled = true;
  state.players[0].resources.ore = 3;
  state.players[0].resources.wheat = 2;
  state = accepted(state, 0, {
    type: COMMAND_TYPES.BUILD_CITY,
    vertexId,
  });

  const cityBefore = state.players[0].resources[targetHex.resource];
  state.phase = GAME_PHASES.AWAITING_ROLL;
  state.turn.hasRolled = false;
  state.rngState = findRngStateForTotal(8);
  state = accepted(state, 0, { type: COMMAND_TYPES.ROLL_DICE });
  assert.equal(
    state.players[0].resources[targetHex.resource],
    cityBefore + 2,
  );
});

test("bank shortage gives nobody that resource for the roll", () => {
  let state = completeSetupWithProducingRoll("phase-2-shortage");
  const dice = predictDice(state);
  const demand = calculateDemand(state, dice.total);
  const shortageResource = RESOURCES.find((resource) => demand[resource].total > 0);
  assert.ok(shortageResource);

  state.bank[shortageResource] = demand[shortageResource].total - 1;
  const handsBefore = state.players.map((player) => player.resources[shortageResource]);
  const bankBefore = state.bank[shortageResource];
  const totalsBefore = resourceTotals(state);

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });

  assert.deepEqual(
    state.players.map((player) => player.resources[shortageResource]),
    handsBefore,
  );
  assert.equal(state.bank[shortageResource], bankBefore);
  assert.ok(
    !state.turn.production.some((entry) => entry.resource === shortageResource),
  );
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "BANK_RESOURCE_SHORTAGE" &&
        event.payload.resource === shortageResource,
    ),
  );
  assert.deepEqual(resourceTotals(state), totalsBefore);
});

test("END_TURN advances players, resets turn state, and wraps the round", () => {
  let state = completeSetupWithStableDice("phase-2-end-turn");
  assert.equal(state.currentPlayerId, 0);
  assert.equal(state.turnNumber, 1);

  for (let turn = 0; turn < 4; turn += 1) {
    assert.equal(state.currentPlayerId, turn);
    state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });
    state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.END_TURN });

    assert.equal(state.phase, GAME_PHASES.AWAITING_ROLL);
    assert.equal(state.turn.hasRolled, false);
    assert.equal(state.turn.dice, null);
    assert.deepEqual(state.turn.production, []);
  }

  assert.equal(state.currentPlayerId, 0);
  assert.equal(state.turnNumber, 2);
});

test("private hand events are only visible to their recipient", () => {
  let state = completeSetupWithNonSevenRoll("phase-2-private-events");
  const dice = predictDice(state);
  const targetHex = state.board.hexes.find(
    (hex) => hex.number === dice.total && hex.resource && hex.id !== state.robberHexId,
  );
  const emptyVertexId = targetHex.vertexIds.find(
    (vertexId) => state.board.vertices[vertexId].building === null,
  );
  state.board.vertices[emptyVertexId].building = { playerId: 0, type: "settlement" };
  state.bank[targetHex.resource] = 19;

  state = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });

  const playerView = projectPlayerView(state, 1);
  assert.ok(
    !playerView.eventLog.some(
      (event) => event.type === "HAND_CHANGED" && event.payload.playerId === 0,
    ),
  );
  assert.ok(
    playerView.eventLog.some((event) => event.type === "RESOURCES_PRODUCED"),
  );
});

test("random bots can complete multiple turns without illegal commands", () => {
  const session = new LocalGameSession({
    gameId: "bot-phase-2-test",
    seed: "bot-phase-2-seed",
    players: [
      { name: "Bot 1", isBot: true },
      { name: "Bot 2", isBot: true },
      { name: "Bot 3", isBot: true },
      { name: "Bot 4", isBot: true },
    ],
  });

  assert.equal(session.start(0).accepted, true);

  let steps = 0;
  while (session.phase !== GAME_PHASES.AWAITING_ROLL && steps < 100) {
    const actorId = session.state.currentPlayerId;
    const command = chooseRandomCommand(session.getView(actorId), () => 0);
    assert.ok(command, `No setup command available at step ${steps}`);
    assert.equal(session.dispatch(actorId, command).accepted, true);
    steps += 1;
  }

  let step = 0;
  while (
    !(
      session.phase === GAME_PHASES.AWAITING_ROLL &&
      session.state.currentPlayerId === 0 &&
      session.state.turnNumber >= 3
    ) &&
    step < 200
  ) {
    let actorId = session.state.currentPlayerId;
    if (session.phase === GAME_PHASES.AWAITING_DISCARD) {
      actorId = Object.keys(session.state.pendingAction.requiredByPlayer)
        .map(Number)
        .find((playerId) => session.state.players[playerId].isBot);
    } else if (session.state.trade) {
      actorId =
        session.state.trade.targetPlayerIds.find(
          (playerId) =>
            !session.state.trade.responses[playerId] &&
            session.state.players[playerId].isBot,
        ) ??
        (session.state.players[session.state.trade.fromPlayerId].isBot
          ? session.state.trade.fromPlayerId
          : undefined);
    }
    assert.notEqual(actorId, undefined, `No bot actor available at step ${step}`);
    const command = chooseRandomCommand(session.getView(actorId), () => 0);
    assert.ok(command, `No turn command available at step ${step}`);
    assert.equal(session.dispatch(actorId, command).accepted, true);
    step += 1;
  }

  assert.equal(session.phase, GAME_PHASES.AWAITING_ROLL);
  assert.equal(session.state.currentPlayerId, 0);
  assert.equal(session.state.turnNumber, 3);
});
