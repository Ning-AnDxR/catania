import { getValidCommands } from "./engine.js";
import {
  calculatePublicVictoryPoints,
  calculateVictoryPoints,
} from "./state.js";

export function projectPlayerView(state, viewerId) {
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

export function projectSpectatorView(state) {
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
