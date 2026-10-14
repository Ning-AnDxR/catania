import test from "node:test";
import assert from "node:assert/strict";

import {
  generateBoard,
  legalBuildRoadEdges,
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
} from "../src/core/board.js";
import { calculateLongestRoadLength } from "../src/core/awards.js";
import {
  COMMAND_TYPES,
  DEVELOPMENT_CARD_COST,
  DEVELOPMENT_CARD_COUNTS,
  DEVELOPMENT_CARD_TYPES,
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
import { calculateVictoryPoints } from "../src/core/state.js";

function accepted(state, actorId, command) {
  const result = dispatchCommand(state, createCommandEnvelope(state, actorId, command));
  assert.equal(result.result.accepted, true, result.result.error?.message);
  assert.equal(result.state.version, state.version + 1);
  return result.state;
}

function acceptedResult(state, actorId, command) {
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

function setupState(seed) {
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

function startTurn(seed) {
  for (let index = 0; index < 50; index += 1) {
    const state = setupState(`${seed}-${index}`);
    const predicted = predictDice(state);
    if (predicted !== 7) {
      return accepted(state, state.currentPlayerId, {
        type: COMMAND_TYPES.ROLL_DICE,
      });
    }
  }
  throw new Error("Unable to find a deterministic non-seven roll.");
}

function predictDice(state) {
  const clone = { rngState: state.rngState };
  const die1 = Math.floor(nextRandom(clone) * 6) + 1;
  const die2 = Math.floor(nextRandom(clone) * 6) + 1;
  return die1 + die2;
}

function setResources(state, playerId, overrides) {
  state.players[playerId].resources = Object.fromEntries(
    RESOURCES.map((resource) => [resource, overrides[resource] || 0]),
  );
  return state;
}

function setRichResources(state, playerId) {
  return setResources(state, playerId, {
    wood: 10,
    brick: 10,
    sheep: 10,
    wheat: 10,
    ore: 10,
  });
}

function giveCard(state, playerId, type, id = `test-card-${type}`) {
  const card = { id, type, revealed: false };
  state.players[playerId].developmentCards.push(card);
  return card;
}

function findPathEdges(board, length) {
  const used = new Set();
  const path = [];

  for (const vertex of board.vertices) {
    if (walk(vertex.id)) return [...path];
  }
  throw new Error(`Unable to find a path of ${length} edges.`);

  function walk(vertexId) {
    if (path.length === length) return true;
    for (const edgeId of board.vertices[vertexId].edgeIds) {
      if (used.has(edgeId)) continue;
      const edge = board.edges[edgeId];
      const nextVertexId = edge.v1 === vertexId ? edge.v2 : edge.v1;
      used.add(edgeId);
      path.push(edgeId);
      if (walk(nextVertexId)) return true;
      path.pop();
      used.delete(edgeId);
    }
    return false;
  }
}

test("the development deck has the standard card distribution", () => {
  assert.equal(
    Object.values(DEVELOPMENT_CARD_COUNTS).reduce((sum, count) => sum + count, 0),
    25,
  );
  assert.equal(DEVELOPMENT_CARD_COUNTS[DEVELOPMENT_CARD_TYPES.KNIGHT], 14);
  assert.equal(DEVELOPMENT_CARD_COUNTS[DEVELOPMENT_CARD_TYPES.VICTORY_POINT], 5);
});

test("buying a development card is private and the card cannot be played that turn", () => {
  let state = startTurn("phase-5-buy");
  state = setRichResources(state, 0);
  const deckBefore = state.developmentDeck.length;
  const bankBefore = { ...state.bank };

  const outcome = acceptedResult(state, 0, { type: COMMAND_TYPES.BUY_DEVELOPMENT_CARD });
  state = outcome.state;
  const card = state.players[0].developmentCards.at(-1);

  assert.equal(state.developmentDeck.length, deckBefore - 1);
  assert.equal(state.players[0].developmentCards.length, 1);
  assert.ok(state.players[0].newDevelopmentCards.includes(card.id));
  for (const [resource, amount] of Object.entries(DEVELOPMENT_CARD_COST)) {
    assert.equal(state.bank[resource], bankBefore[resource] + amount);
  }
  assert.ok(
    outcome.result.events.some(
      (event) => event.type === "DEVELOPMENT_CARD_DRAWN" && event.visibility === "PLAYER",
    ),
  );

  if (card.type === DEVELOPMENT_CARD_TYPES.KNIGHT) {
    rejected(
      state,
      0,
      { type: COMMAND_TYPES.PLAY_KNIGHT, cardId: card.id },
      ERROR_CODES.CARD_BOUGHT_THIS_TURN,
    );
  }
});

test("knight play reuses robber movement and can award largest army", () => {
  let state = setupState("phase-5-knight");
  state.players[0].knightsPlayed = 2;
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.KNIGHT);

  const outcome = acceptedResult(state, 0, {
    type: COMMAND_TYPES.PLAY_KNIGHT,
    cardId: card.id,
  });
  state = outcome.state;

  assert.equal(state.phase, GAME_PHASES.AWAITING_ROBBER_MOVE);
  assert.equal(state.pendingAction.resumePhase, GAME_PHASES.AWAITING_ROLL);
  assert.equal(state.awards.largestArmy, 0);
  assert.ok(outcome.result.events.some((event) => event.type === "LARGEST_ARMY_CHANGED"));
});

test("holding three knight cards does not award largest army before they are played", () => {
  const state = setupState("phase-5-knight-held");
  giveCard(state, 0, DEVELOPMENT_CARD_TYPES.KNIGHT, "held-knight-1");
  giveCard(state, 0, DEVELOPMENT_CARD_TYPES.KNIGHT, "held-knight-2");
  giveCard(state, 0, DEVELOPMENT_CARD_TYPES.KNIGHT, "held-knight-3");

  assert.equal(state.players[0].developmentCards.length, 3);
  assert.equal(state.players[0].knightsPlayed, 0);
  assert.equal(state.awards.largestArmy, null);
});

test("largest army transfers only when another player has more played knights", () => {
  let state = setupState("phase-5-largest-army-transfer");
  state.awards.largestArmy = 0;
  state.players[0].knightsPlayed = 3;
  state.players[1].knightsPlayed = 2;
  state.currentPlayerId = 1;
  state.phase = GAME_PHASES.AWAITING_ROLL;
  state.turn.hasRolled = false;

  const tyingCard = giveCard(
    state,
    1,
    DEVELOPMENT_CARD_TYPES.KNIGHT,
    "transfer-knight-1",
  );
  const tyingOutcome = acceptedResult(state, 1, {
    type: COMMAND_TYPES.PLAY_KNIGHT,
    cardId: tyingCard.id,
  });
  state = tyingOutcome.state;

  assert.equal(state.players[1].knightsPlayed, 3);
  assert.equal(state.awards.largestArmy, 0);
  assert.ok(
    !tyingOutcome.result.events.some(
      (event) => event.type === "LARGEST_ARMY_CHANGED",
    ),
  );

  state.phase = GAME_PHASES.AWAITING_ROLL;
  state.currentPlayerId = 1;
  state.turn.hasRolled = false;
  state.pendingAction = null;
  state.players[1].developmentCardPlayedThisTurn = false;
  const leadingCard = giveCard(
    state,
    1,
    DEVELOPMENT_CARD_TYPES.KNIGHT,
    "transfer-knight-2",
  );
  const leadingOutcome = acceptedResult(state, 1, {
    type: COMMAND_TYPES.PLAY_KNIGHT,
    cardId: leadingCard.id,
  });
  state = leadingOutcome.state;

  assert.equal(state.players[1].knightsPlayed, 4);
  assert.equal(state.awards.largestArmy, 1);
  assert.ok(
    leadingOutcome.result.events.some(
      (event) =>
        event.type === "LARGEST_ARMY_CHANGED" &&
        event.payload.previousPlayerId === 0 &&
        event.payload.newPlayerId === 1 &&
        event.payload.size === 4,
    ),
  );
});

test("road building card places two free roads without spending resources", () => {
  let state = startTurn("phase-5-road-building");
  state = setRichResources(state, 0);
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.ROAD_BUILDING);
  const resourcesBefore = { ...state.players[0].resources };
  const roadsBefore = state.players[0].roads.length;

  state = accepted(state, 0, {
    type: COMMAND_TYPES.PLAY_ROAD_BUILDING,
    cardId: card.id,
  });
  assert.equal(state.phase, GAME_PHASES.AWAITING_FREE_ROAD);

  const firstEdge = legalBuildRoadEdges(state.board, 0)[0];
  state = accepted(state, 0, { type: COMMAND_TYPES.PLACE_FREE_ROAD, edgeId: firstEdge });
  const secondEdge = legalBuildRoadEdges(state.board, 0)[0];
  state = accepted(state, 0, { type: COMMAND_TYPES.PLACE_FREE_ROAD, edgeId: secondEdge });

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(state.players[0].roads.length, roadsBefore + 2);
  assert.deepEqual(state.players[0].resources, resourcesBefore);
});

test("year of plenty allows two bank resource choices", () => {
  let state = startTurn("phase-5-year");
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY);
  const woodBefore = state.players[0].resources.wood;
  const oreBefore = state.players[0].resources.ore;

  state = accepted(state, 0, {
    type: COMMAND_TYPES.PLAY_YEAR_OF_PLENTY,
    cardId: card.id,
  });
  assert.equal(state.phase, GAME_PHASES.AWAITING_RESOURCE_CHOICE);
  state = accepted(state, 0, { type: COMMAND_TYPES.CHOOSE_RESOURCE, resource: "wood" });
  state = accepted(state, 0, { type: COMMAND_TYPES.CHOOSE_RESOURCE, resource: "ore" });

  assert.equal(state.phase, GAME_PHASES.TURN_ACTIONS);
  assert.equal(state.players[0].resources.wood, woodBefore + 1);
  assert.equal(state.players[0].resources.ore, oreBefore + 1);
});

test("monopoly takes all of the chosen resource from opponents", () => {
  let state = startTurn("phase-5-monopoly");
  state.players[0].resources.wood = 0;
  state.players[1].resources.wood = 3;
  state.players[2].resources.wood = 2;
  state.players[3].resources.wood = 0;
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.MONOPOLY);

  const outcome = acceptedResult(state, 0, {
    type: COMMAND_TYPES.PLAY_MONOPOLY,
    cardId: card.id,
    resource: "wood",
  });
  state = outcome.state;

  assert.equal(state.players[0].resources.wood, 5);
  assert.equal(state.players[1].resources.wood, 0);
  assert.equal(state.players[2].resources.wood, 0);
  assert.ok(outcome.result.events.some((event) => event.type === "MONOPOLY_RESOLVED"));
});

test("monopoly transfers only the selected resource", () => {
  let state = startTurn("phase-5-monopoly-selected-resource");
  state = setResources(state, 0, { ore: 1 });
  state = setResources(state, 1, { wood: 3, ore: 4 });
  state = setResources(state, 2, { wood: 2, ore: 1 });
  state = setResources(state, 3, {});
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.MONOPOLY);

  state = accepted(state, 0, {
    type: COMMAND_TYPES.PLAY_MONOPOLY,
    cardId: card.id,
    resource: "wood",
  });

  assert.equal(state.players[0].resources.wood, 5);
  assert.equal(state.players[0].resources.ore, 1);
  assert.equal(state.players[1].resources.ore, 4);
  assert.equal(state.players[2].resources.ore, 1);
});

test("monopoly gains zero when opponents do not hold the selected resource", () => {
  let state = startTurn("phase-5-monopoly-empty");
  state = setResources(state, 0, { ore: 1 });
  state = setResources(state, 1, { wood: 3 });
  state = setResources(state, 2, { wood: 2 });
  state = setResources(state, 3, {});
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.MONOPOLY);

  const outcome = acceptedResult(state, 0, {
    type: COMMAND_TYPES.PLAY_MONOPOLY,
    cardId: card.id,
    resource: "ore",
  });
  state = outcome.state;
  const resolved = outcome.result.events.find(
    (event) => event.type === "MONOPOLY_RESOLVED",
  );

  assert.equal(state.players[0].resources.ore, 1);
  assert.deepEqual(resolved.payload.gains, []);
  assert.equal(state.players[0].developmentCardPlayedThisTurn, true);
});

test("victory point cards count privately and can trigger game over when revealed", () => {
  let state = startTurn("phase-5-victory-point");
  state.players[0].settlements = Array.from({ length: 9 }, (_, index) => index);
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.VICTORY_POINT);

  const outcome = acceptedResult(state, 0, {
    type: COMMAND_TYPES.REVEAL_VICTORY_POINT,
    cardId: card.id,
  });
  state = outcome.state;

  assert.equal(calculateVictoryPoints(state, 0), 10);
  assert.equal(state.phase, GAME_PHASES.GAME_OVER);
  assert.equal(state.players[0].developmentCards[0].revealed, true);
  assert.ok(outcome.result.events.some((event) => event.type === "GAME_ENDED"));
});

test("longest road analysis recognizes a five-road path", () => {
  const board = generateBoard("phase-5-longest-road");
  const path = findPathEdges(board, 5);
  for (const edgeId of path) {
    board.edges[edgeId].road = { playerId: 0 };
  }

  assert.equal(calculateLongestRoadLength(board, 0), 5);
});

test("a closed six-road loop counts as a five-road continuous path", () => {
  const board = generateBoard("phase-5-longest-road-loop");
  const loopEdges = board.hexes[0].edgeIds;
  for (const edgeId of loopEdges) {
    board.edges[edgeId].road = { playerId: 0 };
  }

  assert.equal(calculateLongestRoadLength(board, 0), 5);
});

test("disconnected road groups are not added together", () => {
  const edgePairs = [
    [0, 1],
    [1, 2],
    [2, 3],
    [4, 5],
    [5, 6],
    [6, 7],
  ];
  const vertices = Array.from({ length: 8 }, (_, id) => ({
    id,
    edgeIds: [],
    building: null,
  }));
  const board = {
    vertices,
    edges: edgePairs.map(([v1, v2], id) => ({
      id,
      v1,
      v2,
      road: { playerId: 0 },
    })),
  };
  for (const edge of board.edges) {
    vertices[edge.v1].edgeIds.push(edge.id);
    vertices[edge.v2].edgeIds.push(edge.id);
  }

  assert.equal(calculateLongestRoadLength(board, 0), 3);
});

test("building the fifth road awards longest road", () => {
  let state = startTurn("phase-5-longest-road-award");
  state = setRichResources(state, 0);
  const path = findPathEdges(state.board, 5);

  for (const player of state.players) {
    player.roads = [];
    player.settlements = [];
    player.cities = [];
  }
  for (const edge of state.board.edges) edge.road = null;
  for (const vertex of state.board.vertices) vertex.building = null;

  for (const edgeId of path.slice(0, 4)) {
    state.board.edges[edgeId].road = { playerId: 0 };
    state.players[0].roads.push(edgeId);
  }

  const outcome = acceptedResult(state, 0, {
    type: COMMAND_TYPES.BUILD_ROAD,
    edgeId: path[4],
  });
  state = outcome.state;

  assert.equal(state.awards.longestRoad, 0);
  assert.ok(outcome.result.events.some((event) => event.type === "LONGEST_ROAD_CHANGED"));
});

test("PlayerView hides the deck and opponent development cards", () => {
  const state = setupState("phase-5-projection");
  const card = giveCard(state, 0, DEVELOPMENT_CARD_TYPES.KNIGHT);
  const ownView = projectPlayerView(state, 0);
  const view = projectPlayerView(state, 1);

  assert.equal(ownView.players[0].developmentCards[0].type, DEVELOPMENT_CARD_TYPES.KNIGHT);
  assert.deepEqual(ownView.players[0].newDevelopmentCardIds, []);
  assert.equal(view.developmentDeckCount, state.developmentDeck.length);
  assert.equal(view.players[0].developmentCards, null);
  assert.equal(view.players[0].developmentCardCount, 1);
  assert.equal(view.players[0].resources, null);
  assert.equal(view.awards.longestRoad, null);
  assert.equal(card.revealed, false);
});
