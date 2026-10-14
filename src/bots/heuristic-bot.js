import {
  BUILD_COSTS,
  COMMAND_TYPES,
  DEVELOPMENT_CARD_TYPES,
  EVENT_TYPES,
  PIECE_LIMITS,
  RESOURCES,
} from "../core/constants.js";
import {
  legalBuildCityVertices,
  legalBuildRoadEdges,
  legalBuildSettlementVertices,
} from "../core/board.js";
import { chooseRandomCommand } from "./random-bot.js";

export const AI_DIFFICULTIES = Object.freeze(["easy", "medium", "hard"]);

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

export function chooseBotCommand(
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
