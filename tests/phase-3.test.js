import test from "node:test";
import assert from "node:assert/strict";

import {
  isVertexFree,
  legalBuildCityVertices,
  legalBuildRoadEdges,
  legalBuildSettlementVertices,
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
} from "../src/core/board.js";
import {
  BUILD_COSTS,
  COMMAND_TYPES,
  ERROR_CODES,
  GAME_PHASES,
  PIECE_LIMITS,
  RESOURCES,
  SETUP_STEPS,
  VICTORY_POINTS_TO_WIN,
} from "../src/core/constants.js";
import {
  createCommandEnvelope,
  createDefaultPlayers,
  createGame,
  dispatchCommand,
  getValidCommands,
} from "../src/core/engine.js";
import { nextRandom } from "../src/core/rng.js";
import { calculateVictoryPoints } from "../src/core/state.js";

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
  return die1 + die2;
}

function startTurn(seed = "phase-3-test") {
  for (let index = 0; index < 50; index += 1) {
    const candidate = startTurnCandidate(`${seed}-${index}`);
    if (predictDice(candidate) !== 7) {
      return accepted(candidate, candidate.currentPlayerId, {
        type: COMMAND_TYPES.ROLL_DICE,
      }).state;
    }
  }

  throw new Error("Unable to find a deterministic non-seven roll.");
}

function startTurnCandidate(seed) {
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

function setResources(state, playerId, overrides) {
  state.players[playerId].resources = Object.fromEntries(
    RESOURCES.map((resource) => [resource, overrides[resource] || 0]),
  );
  return state;
}

function setBuildResources(state, playerId) {
  return setResources(state, playerId, {
    wood: 10,
    brick: 10,
    sheep: 10,
    wheat: 10,
    ore: 10,
  });
}

function resourceTotals(state) {
  const totals = Object.fromEntries(RESOURCES.map((resource) => [resource, 0]));
  for (const player of state.players) {
    for (const resource of RESOURCES) totals[resource] += player.resources[resource];
  }
  for (const resource of RESOURCES) totals[resource] += state.bank[resource];
  return totals;
}

function openSettlementTarget(state, playerId = 0) {
  let next = state;

  for (let step = 0; step < 8; step += 1) {
    const vertexId = legalBuildSettlementVertices(next.board, playerId)[0];
    if (vertexId !== undefined) return { state: next, vertexId };

    const edgeId = legalBuildRoadEdges(next.board, playerId)[0];
    assert.notEqual(edgeId, undefined, `No road can extend the network at step ${step}`);
    next = accepted(next, playerId, {
      type: COMMAND_TYPES.BUILD_ROAD,
      edgeId,
    }).state;
  }

  throw new Error("Unable to open a legal settlement target.");
}

test("BUILD_ROAD spends resources and extends the player's road network", () => {
  let state = startTurn("phase-3-road");
  state = setBuildResources(state, 0);
  const edgeId = legalBuildRoadEdges(state.board, 0)[0];
  assert.notEqual(edgeId, undefined);
  const roadsBefore = state.players[0].roads.length;

  const outcome = accepted(state, 0, { type: COMMAND_TYPES.BUILD_ROAD, edgeId });
  const next = outcome.state;

  assert.equal(next.board.edges[edgeId].road.playerId, 0);
  assert.equal(next.players[0].roads.length, roadsBefore + 1);
  assert.equal(
    next.players[0].resources.wood,
    state.players[0].resources.wood - BUILD_COSTS.road.wood,
  );
  assert.equal(
    next.players[0].resources.brick,
    state.players[0].resources.brick - BUILD_COSTS.road.brick,
  );
  assert.ok(outcome.result.events.some((event) => event.type === "RESOURCES_SPENT"));
  assert.ok(outcome.result.events.some((event) => event.type === "ROAD_PLACED"));
});

test("building returns spent resource cards to the bank", () => {
  let state = startTurn("phase-3-return-to-bank");
  state = setBuildResources(state, 0);
  const edgeId = legalBuildRoadEdges(state.board, 0)[0];
  const totalsBefore = resourceTotals(state);
  const bankBefore = { ...state.bank };

  state = accepted(state, 0, { type: COMMAND_TYPES.BUILD_ROAD, edgeId }).state;

  assert.deepEqual(resourceTotals(state), totalsBefore);
  assert.equal(state.bank.wood, bankBefore.wood + BUILD_COSTS.road.wood);
  assert.equal(state.bank.brick, bankBefore.brick + BUILD_COSTS.road.brick);
});

test("rejects a road that does not connect to the player's network", () => {
  let state = startTurn("phase-3-road-disconnected");
  state = setBuildResources(state, 0);
  const legalEdges = new Set(legalBuildRoadEdges(state.board, 0));
  const disconnectedEdge = state.board.edges.find(
    (edge) => !edge.road && !legalEdges.has(edge.id),
  );
  assert.ok(disconnectedEdge);

  rejected(
    state,
    0,
    { type: COMMAND_TYPES.BUILD_ROAD, edgeId: disconnectedEdge.id },
    ERROR_CODES.ROAD_NOT_CONNECTED,
  );
});

test("rejects a road touching an opponent building", () => {
  let state = startTurn("phase-3-road-opponent-building");
  state = setBuildResources(state, 0);
  const opponentVertex = state.board.vertices.find(
    (vertex) => vertex.building?.playerId === 1,
  );
  assert.ok(opponentVertex);

  const blockedEdge = opponentVertex.edgeIds
    .map((edgeId) => state.board.edges[edgeId])
    .find((edge) => !edge.road);
  assert.ok(blockedEdge);

  rejected(
    state,
    0,
    { type: COMMAND_TYPES.BUILD_ROAD, edgeId: blockedEdge.id },
    ERROR_CODES.ROAD_NOT_CONNECTED,
  );
});

test("BUILD_SETTLEMENT spends resources, places a settlement, and adds one victory point", () => {
  let state = startTurn("phase-3-settlement");
  state = setBuildResources(state, 0);
  const prepared = openSettlementTarget(state, 0);
  state = prepared.state;
  const { vertexId } = prepared;
  const victoryPointsBefore = calculateVictoryPoints(state, 0);

  const outcome = accepted(state, 0, {
    type: COMMAND_TYPES.BUILD_SETTLEMENT,
    vertexId,
  });
  const next = outcome.state;

  assert.deepEqual(next.board.vertices[vertexId].building, {
    playerId: 0,
    type: "settlement",
  });
  assert.ok(next.players[0].settlements.includes(vertexId));
  assert.equal(calculateVictoryPoints(next, 0), victoryPointsBefore + 1);
  assert.equal(
    next.players[0].resources.wood,
    state.players[0].resources.wood - BUILD_COSTS.settlement.wood,
  );
  assert.ok(
    outcome.result.events.some((event) => event.type === "VICTORY_POINTS_CHANGED"),
  );
});

test("rejects a settlement without a connecting road or with insufficient resources", () => {
  let state = startTurn("phase-3-settlement-validation");
  state = setBuildResources(state, 0);

  const prepared = openSettlementTarget(state, 0);
  state = prepared.state;
  const connected = new Set(legalBuildSettlementVertices(state.board, 0));
  const disconnectedVertex = state.board.vertices.find(
    (vertex) => !vertex.building && isVertexFree(state.board, vertex.id) && !connected.has(vertex.id),
  );
  assert.ok(disconnectedVertex);

  rejected(
    state,
    0,
    { type: COMMAND_TYPES.BUILD_SETTLEMENT, vertexId: disconnectedVertex.id },
    ERROR_CODES.ROAD_NOT_CONNECTED,
  );

  setResources(state, 0, { wood: 1, brick: 1, sheep: 1, wheat: 0 });
  rejected(
    state,
    0,
    { type: COMMAND_TYPES.BUILD_SETTLEMENT, vertexId: prepared.vertexId },
    ERROR_CODES.INSUFFICIENT_RESOURCES,
  );
});

test("BUILD_CITY upgrades the player's settlement and adds one victory point", () => {
  let state = startTurn("phase-3-city");
  state = setBuildResources(state, 0);
  const vertexId = legalBuildCityVertices(state.board, 0)[0];
  assert.notEqual(vertexId, undefined);
  const victoryPointsBefore = calculateVictoryPoints(state, 0);

  const outcome = accepted(state, 0, { type: COMMAND_TYPES.BUILD_CITY, vertexId });
  const next = outcome.state;

  assert.deepEqual(next.board.vertices[vertexId].building, {
    playerId: 0,
    type: "city",
  });
  assert.ok(!next.players[0].settlements.includes(vertexId));
  assert.ok(next.players[0].cities.includes(vertexId));
  assert.equal(calculateVictoryPoints(next, 0), victoryPointsBefore + 1);
  assert.ok(outcome.result.events.some((event) => event.type === "CITY_PLACED"));
});

test("rejects building when the corresponding piece limit has been reached", () => {
  let roadState = startTurn("phase-3-road-limit");
  roadState = setBuildResources(roadState, 0);
  roadState.players[0].roads = Array.from({ length: PIECE_LIMITS.road }, (_, index) => index);
  rejected(
    roadState,
    0,
    {
      type: COMMAND_TYPES.BUILD_ROAD,
      edgeId: legalBuildRoadEdges(roadState.board, 0)[0],
    },
    ERROR_CODES.RESOURCE_LIMIT_REACHED,
  );

  let cityState = startTurn("phase-3-city-limit");
  cityState = setBuildResources(cityState, 0);
  cityState.players[0].cities = Array.from({ length: PIECE_LIMITS.city }, (_, index) => index);
  rejected(
    cityState,
    0,
    {
      type: COMMAND_TYPES.BUILD_CITY,
      vertexId: legalBuildCityVertices(cityState.board, 0)[0],
    },
    ERROR_CODES.RESOURCE_LIMIT_REACHED,
  );
});

test("allows multiple legal builds in the same turn", () => {
  let state = startTurn("phase-3-multiple-builds");
  state = setBuildResources(state, 0);
  const prepared = openSettlementTarget(state, 0);
  state = prepared.state;
  const { vertexId } = prepared;
  state = accepted(state, 0, {
    type: COMMAND_TYPES.BUILD_SETTLEMENT,
    vertexId,
  }).state;

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  const commands = getValidCommands(state, 0);
  assert.ok(commands.some((command) => command.type === COMMAND_TYPES.END_TURN));
});

test("ending the game at ten victory points sets GAME_OVER and records the winner", () => {
  let state = startTurn("phase-3-win");
  state = setBuildResources(state, 0);
  const vertexId = legalBuildCityVertices(state.board, 0)[0];
  state.players[0].cities = [100, 101, 102];
  if (!state.players[0].settlements.includes(103)) state.players[0].settlements.push(103);
  assert.equal(calculateVictoryPoints(state, 0), VICTORY_POINTS_TO_WIN - 1);

  const outcome = accepted(state, 0, { type: COMMAND_TYPES.BUILD_CITY, vertexId });
  const next = outcome.state;

  assert.equal(calculateVictoryPoints(next, 0), VICTORY_POINTS_TO_WIN);
  assert.equal(next.phase, GAME_PHASES.GAME_OVER);
  assert.equal(next.winnerId, 0);
  assert.deepEqual(getValidCommands(next, 0), []);
  assert.ok(outcome.result.events.some((event) => event.type === "GAME_ENDED"));
});
