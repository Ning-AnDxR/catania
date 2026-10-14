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
import { createResourcePool } from "../src/core/state.js";

function accepted(state, actorId, command) {
  const result = dispatchCommand(state, createCommandEnvelope(state, actorId, command));
  assert.equal(result.result.accepted, true, result.result.error?.message);
  assert.equal(result.state.version, state.version + 1);
  return result;
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
  return { die1, die2, total: die1 + die2 };
}

function createSetupState(seed) {
  let state = accepted(
    createGame({
      gameId: `game-${seed}`,
      seed,
      players: createDefaultPlayers(4),
    }),
    0,
    { type: COMMAND_TYPES.START_GAME },
  ).state;

  while (state.phase !== GAME_PHASES.AWAITING_ROLL) {
    state = accepted(state, state.currentPlayerId, setupCommand(state)).state;
  }
  return state;
}

function findSevenSetup(prefix = "phase-4") {
  for (let index = 0; index < 100; index += 1) {
    const state = createSetupState(`${prefix}-${index}`);
    if (predictDice(state).total === 7) return state;
  }
  throw new Error("Unable to find a deterministic seven roll.");
}

function setHand(state, playerId, resources) {
  state.players[playerId].resources = Object.fromEntries(
    RESOURCES.map((resource) => [resource, resources[resource] || 0]),
  );
  return state;
}

function resourceTotal(state) {
  return state.players.reduce(
    (total, player) =>
      total + Object.values(player.resources).reduce((sum, amount) => sum + amount, 0),
    Object.values(state.bank).reduce((sum, amount) => sum + amount, 0),
  );
}

function rollSeven(state) {
  return accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE }).state;
}

test("rolling seven produces no resources and starts required discards", () => {
  let state = findSevenSetup("phase-4-no-production");
  state = setHand(state, 0, { wood: 8 });
  state = setHand(state, 1, { brick: 7 });
  state = setHand(state, 2, { sheep: 9 });
  state = setHand(state, 3, {});
  const totalBefore = resourceTotal(state);

  const outcome = accepted(state, state.currentPlayerId, { type: COMMAND_TYPES.ROLL_DICE });
  const next = outcome.state;

  assert.equal(next.phase, GAME_PHASES.AWAITING_DISCARD);
  assert.equal(next.pendingAction.requiredByPlayer[0], 4);
  assert.equal(next.pendingAction.requiredByPlayer[1], undefined);
  assert.equal(next.pendingAction.requiredByPlayer[2], 4);
  assert.ok(!outcome.result.events.some((event) => event.type === "RESOURCES_PRODUCED"));
  assert.equal(resourceTotal(next), totalBefore);
});

test("seven moves directly to robber movement when nobody exceeds seven cards", () => {
  let state = findSevenSetup("phase-4-no-discard");
  state = setHand(state, 0, { wood: 7 });
  state = setHand(state, 1, { brick: 6 });
  state = setHand(state, 2, {});
  state = setHand(state, 3, {});

  state = rollSeven(state);

  assert.equal(state.phase, GAME_PHASES.AWAITING_ROBBER_MOVE);
  assert.equal(state.pendingAction.type, "ROBBER_MOVE");
  assert.equal(state.pendingAction.playerId, state.currentPlayerId);
});

test("all over-limit players must discard before the robber can move", () => {
  let state = findSevenSetup("phase-4-discard");
  state = setHand(state, 0, { wood: 8 });
  state = setHand(state, 1, { brick: 9 });
  state = setHand(state, 2, {});
  state = setHand(state, 3, {});
  state = rollSeven(state);
  const totalBefore = resourceTotal(state);
  const bankBefore = { ...state.bank };

  rejected(
    state,
    0,
    {
      type: COMMAND_TYPES.DISCARD_RESOURCES,
      resources: { wood: 3 },
    },
    ERROR_CODES.DISCARD_COUNT_MISMATCH,
  );

  state = accepted(state, 0, {
    type: COMMAND_TYPES.DISCARD_RESOURCES,
    resources: { wood: 4 },
  }).state;
  assert.equal(state.phase, GAME_PHASES.AWAITING_DISCARD);
  assert.equal(state.players[0].resources.wood, 4);

  state = accepted(state, 1, {
    type: COMMAND_TYPES.DISCARD_RESOURCES,
    resources: { brick: 4 },
  }).state;
  assert.equal(state.phase, GAME_PHASES.AWAITING_ROBBER_MOVE);
  assert.equal(state.players[1].resources.brick, 5);
  assert.equal(state.bank.wood, bankBefore.wood + 4);
  assert.equal(state.bank.brick, bankBefore.brick + 4);
  assert.equal(resourceTotal(state), totalBefore);
});

test("moving the robber without a victim resumes turn actions", () => {
  let state = findSevenSetup("phase-4-move-no-victim");
  for (const player of state.players) player.resources = createResourcePool();
  state = rollSeven(state);
  const targetHexId = state.board.hexes.find((hex) => hex.id !== state.robberHexId).id;

  const outcome = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.MOVE_ROBBER,
    hexId: targetHexId,
  });
  const next = outcome.state;

  assert.equal(next.robberHexId, targetHexId);
  assert.equal(next.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(next.pendingAction, null);
  assert.ok(outcome.result.events.some((event) => event.type === "ROBBER_MOVED"));
});

test("one valid victim is stolen from automatically", () => {
  let state = findSevenSetup("phase-4-single-victim");
  for (const player of state.players) player.resources = createResourcePool();
  const victimVertex = state.board.vertices.find(
    (vertex) => vertex.building?.playerId === 1,
  );
  assert.ok(victimVertex);
  const targetHexId = victimVertex.hexIds[0];
  state.players[1].resources.wood = 1;
  state = rollSeven(state);
  const totalBefore = resourceTotal(state);

  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.MOVE_ROBBER,
    hexId: targetHexId,
  }).state;

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(state.players[1].resources.wood, 0);
  assert.equal(state.players[0].resources.wood, 1);
  assert.equal(resourceTotal(state), totalBefore);
  assert.ok(
    state.eventLog.some(
      (event) =>
        event.type === "RESOURCE_STOLEN" &&
        event.visibility === "PLAYER" &&
        event.recipientPlayerId === 0,
    ),
  );
});

test("multiple victims require an explicit steal target", () => {
  let state = findSevenSetup("phase-4-multiple-victims");
  for (const player of state.players) player.resources = createResourcePool();
  const targetHex = state.board.hexes.find((hex) => hex.id !== state.robberHexId);
  const [firstVertexId, secondVertexId] = targetHex.vertexIds;
  state.board.vertices[firstVertexId].building = { playerId: 1, type: "settlement" };
  state.board.vertices[secondVertexId].building = { playerId: 2, type: "settlement" };
  state.players[1].resources.wood = 1;
  state.players[2].resources.brick = 1;
  state = rollSeven(state);

  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.MOVE_ROBBER,
    hexId: targetHex.id,
  }).state;
  assert.equal(state.phase, GAME_PHASES.AWAITING_STEAL_TARGET);
  assert.deepEqual(state.pendingAction.candidatePlayerIds, [1, 2]);

  rejected(
    state,
    state.currentPlayerId,
    { type: COMMAND_TYPES.CHOOSE_STEAL_TARGET, playerId: 3 },
    ERROR_CODES.INVALID_STEAL_TARGET,
  );

  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.CHOOSE_STEAL_TARGET,
    playerId: 1,
  }).state;

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(state.players[1].resources.wood, 0);
  assert.equal(state.players[0].resources.wood, 1);
});

test("PlayerView hides other players' exact hands and private steal events", () => {
  let state = findSevenSetup("phase-4-private");
  for (const player of state.players) player.resources = createResourcePool();
  const victimVertex = state.board.vertices.find(
    (vertex) => vertex.building?.playerId === 1,
  );
  state.players[1].resources.ore = 2;
  state = rollSeven(state);
  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.MOVE_ROBBER,
    hexId: victimVertex.hexIds[0],
  }).state;

  const ownView = projectPlayerView(state, 0);
  const opponentView = projectPlayerView(state, 1);
  assert.ok(ownView.players[0].resources);
  assert.equal(ownView.players[1].resources, null);
  assert.equal(ownView.players[1].resourceCount, 1);
  assert.ok(
    ownView.eventLog.some((event) => event.type === "RESOURCE_STOLEN"),
  );
  assert.ok(
    !opponentView.eventLog.some((event) => event.type === "RESOURCE_STOLEN"),
  );
  assert.ok(
    opponentView.eventLog.some((event) => event.type === "RESOURCE_LOST"),
  );
});

test("random bots can complete a seven, discard, robber, and steal sequence", () => {
  let session = null;
  let steps = 0;
  for (let index = 0; index < 100; index += 1) {
    const candidate = new LocalGameSession({
      gameId: `bot-phase-4-${index}`,
      seed: `bot-phase-4-${index}`,
      players: [
        { name: "Bot 1", isBot: true },
        { name: "Bot 2", isBot: true },
        { name: "Bot 3", isBot: true },
        { name: "Bot 4", isBot: true },
      ],
    });
    candidate.start(0);

    steps = 0;
    while (candidate.phase !== GAME_PHASES.AWAITING_ROLL && steps < 100) {
      const actorId = candidate.state.currentPlayerId;
      const command = chooseRandomCommand(candidate.getView(actorId), () => 0);
      candidate.dispatch(actorId, command);
      steps += 1;
    }

    if (predictDice(candidate.state).total === 7) {
      session = candidate;
      break;
    }
  }

  assert.ok(session);
  session.state.players[0].resources = createResourcePool();
  session.state.players[1].resources = createResourcePool();
  session.state.players[2].resources = createResourcePool();
  session.state.players[3].resources = createResourcePool();
  session.state.players[0].resources.wood = 8;
  session.state.players[1].resources.brick = 9;
  session.state.players[1].resources.wood = 1;

  assert.equal(session.dispatch(0, { type: COMMAND_TYPES.ROLL_DICE }).accepted, true);

  steps = 0;
  while (session.phase !== GAME_PHASES.TURN_ACTIONS && steps < 100) {
    let actorId = session.state.currentPlayerId;
    if (session.phase === GAME_PHASES.AWAITING_DISCARD) {
      actorId = Object.keys(session.state.pendingAction.requiredByPlayer)
        .map(Number)
        .find((playerId) => session.state.players[playerId].isBot);
    }
    const command = chooseRandomCommand(session.getView(actorId), () => 0);
    assert.ok(command, `No command available at step ${steps}`);
    assert.equal(session.dispatch(actorId, command).accepted, true);
    steps += 1;
  }

  assert.equal(session.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(session.state.pendingAction, null);
});
