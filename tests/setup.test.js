import test from "node:test";
import assert from "node:assert/strict";

import {
  generateBoard,
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
} from "../src/core/board.js";
import {
  BANK_PER_RESOURCE,
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

function startGame(seed = "setup-test") {
  const lobby = createGame({
    gameId: "game-setup-test",
    seed,
    players: createDefaultPlayers(4),
  });
  return accepted(lobby, 0, { type: COMMAND_TYPES.START_GAME });
}

function placeNextSetupPair(state, choose = null) {
  const actorId = state.currentPlayerId;
  const actorView = {
    validCommands:
      state.setup.step === SETUP_STEPS.SETTLEMENT
        ? legalInitialSettlementVertices(state.board).map((vertexId) => ({
            type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
            vertexId,
          }))
        : legalInitialRoadEdges(
            state.board,
            state.setup.lastSettlementVertexId,
          ).map((edgeId) => ({
            type: COMMAND_TYPES.PLACE_INITIAL_ROAD,
            edgeId,
          })),
  };
  const command = choose ? choose(actorView, state) : actorView.validCommands[0];
  return accepted(state, actorId, command);
}

test("starts with a snake setup order", () => {
  let state = startGame();
  assert.equal(state.phase, GAME_PHASES.SETUP_ROUND_1);
  assert.deepEqual(state.setup.order, [0, 1, 2, 3, 3, 2, 1, 0]);
  assert.equal(state.currentPlayerId, 0);
  assert.equal(state.setup.step, SETUP_STEPS.SETTLEMENT);
});

test("grants one of each resource to every player at game start", () => {
  const state = startGame("starting-resource-defaults");

  for (const player of state.players) {
    for (const resource of RESOURCES) {
      assert.equal(player.resources[resource], 1);
    }
  }
  for (const resource of RESOURCES) {
    assert.equal(state.bank[resource], BANK_PER_RESOURCE - state.players.length);
  }
});

test("rejects settlement placement when it is not the player's turn", () => {
  const state = startGame();
  const vertexId = legalInitialSettlementVertices(state.board)[0];
  rejected(
    state,
    1,
    { type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT, vertexId },
    ERROR_CODES.NOT_YOUR_TURN,
  );
});

test("rejects an initial road that does not touch the new settlement", () => {
  let state = startGame();
  const settlementVertexId = legalInitialSettlementVertices(state.board)[0];
  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
    vertexId: settlementVertexId,
  });

  const legalEdgeIds = new Set(legalInitialRoadEdges(state.board, settlementVertexId));
  const disconnectedEdge = state.board.edges.find((edge) => !legalEdgeIds.has(edge.id));
  rejected(
    state,
    state.currentPlayerId,
    { type: COMMAND_TYPES.PLACE_INITIAL_ROAD, edgeId: disconnectedEdge.id },
    ERROR_CODES.ROAD_NOT_CONNECTED,
  );
});

test("rejects a settlement adjacent to an existing settlement", () => {
  let state = startGame();
  const settlementVertexId = legalInitialSettlementVertices(state.board)[0];
  const settlementVertex = state.board.vertices[settlementVertexId];
  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
    vertexId: settlementVertexId,
  });

  const roadEdgeId = legalInitialRoadEdges(state.board, settlementVertexId)[0];
  state = accepted(state, state.currentPlayerId, {
    type: COMMAND_TYPES.PLACE_INITIAL_ROAD,
    edgeId: roadEdgeId,
  });

  rejected(
    state,
    state.currentPlayerId,
    {
      type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
      vertexId: settlementVertex.adjacentVertexIds[0],
    },
    ERROR_CODES.DISTANCE_RULE_VIOLATION,
  );
});

test("initial settlements do not produce extra resources", () => {
  let state = startGame("starting-resource-test");

  while (state.phase !== GAME_PHASES.AWAITING_ROLL) {
    const beforeResources = { ...state.players[state.currentPlayerId].resources };
    const isSecondRoundSettlement =
      state.phase === GAME_PHASES.SETUP_ROUND_2 &&
      state.setup.step === SETUP_STEPS.SETTLEMENT;

    if (isSecondRoundSettlement) {
      const vertexId = legalInitialSettlementVertices(state.board)[0];

      state = placeNextSetupPair(state, () => ({
        type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
        vertexId,
      }));

      const afterResources = state.players[state.currentPlayerId].resources;
      for (const resource of RESOURCES) {
        assert.equal(afterResources[resource], beforeResources[resource]);
      }
      if (state.phase !== GAME_PHASES.AWAITING_ROLL) {
        state = placeNextSetupPair(state);
      }
    } else {
      state = placeNextSetupPair(state);
    }
  }

  assert.equal(state.currentPlayerId, 0);
  assert.equal(state.turnNumber, 1);
  for (const player of state.players) {
    assert.equal(player.settlements.length, 2);
    assert.equal(player.roads.length, 2);
  }
});

test("rejects stale versions without changing state", () => {
  const state = startGame();
  const staleEnvelope = createCommandEnvelope(state, state.currentPlayerId, {
    type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
    vertexId: legalInitialSettlementVertices(state.board)[0],
  });
  staleEnvelope.expectedVersion -= 1;

  const result = dispatchCommand(state, staleEnvelope);
  assert.equal(result.result.accepted, false);
  assert.equal(result.result.error.code, ERROR_CODES.VERSION_CONFLICT);
  assert.equal(result.state, state);
});

test("board and setup are deterministic for the same seed", () => {
  const firstBoard = generateBoard("deterministic");
  const secondBoard = generateBoard("deterministic");
  assert.deepEqual(firstBoard, secondBoard);

  const firstState = startGame("deterministic");
  const secondState = startGame("deterministic");
  assert.deepEqual(firstState, secondState);
});
