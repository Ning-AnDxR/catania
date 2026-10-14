import {
  BANK_PER_RESOURCE,
  DEVELOPMENT_CARD_TYPES,
  GAME_PHASES,
  PLAYER_COLORS,
  RESOURCES,
} from "./constants.js";
import { hashSeed } from "./rng.js";

export function createResourcePool(amount = 0) {
  return Object.fromEntries(RESOURCES.map((resource) => [resource, amount]));
}

export function createLobbyState({
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

export function createSetupOrder(playerCount) {
  const forward = Array.from({ length: playerCount }, (_, index) => index);
  const backward = [...forward].reverse();
  return [...forward, ...backward];
}

export function calculateVictoryPoints(state, playerId) {
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

export function calculatePublicVictoryPoints(state, playerId) {
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
