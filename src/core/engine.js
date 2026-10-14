import {
  BUILD_COSTS,
  COMMAND_TYPES,
  DEFAULT_PLAYER_NAMES,
  DEVELOPMENT_CARD_COUNTS,
  DEVELOPMENT_CARD_COST,
  DEVELOPMENT_CARD_TYPES,
  ERROR_CODES,
  EVENT_TYPES,
  GAME_PHASES,
  PIECE_LIMITS,
  RESOURCES,
  SETUP_STEPS,
  STARTING_RESOURCES_PER_TYPE,
  VICTORY_POINTS_TO_WIN,
} from "./constants.js";
import {
  generateBoard,
  isRoadConnectedToPlayer,
  isVertexFree,
  legalBuildCityVertices,
  legalBuildRoadEdges,
  legalBuildSettlementVertices,
  legalInitialRoadEdges,
  legalInitialSettlementVertices,
} from "./board.js";
import { calculateLongestRoadLength } from "./awards.js";
import { appendEvent } from "./events.js";
import { nextRandom, shuffle } from "./rng.js";
import {
  calculateVictoryPoints,
  calculatePublicVictoryPoints,
  createLobbyState,
  createResourcePool,
  createSetupOrder,
} from "./state.js";

export const SETUP_COMMANDS = new Set([
  COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
  COMMAND_TYPES.PLACE_INITIAL_ROAD,
]);

export const BUILD_COMMANDS = new Set([
  COMMAND_TYPES.BUILD_ROAD,
  COMMAND_TYPES.BUILD_SETTLEMENT,
  COMMAND_TYPES.BUILD_CITY,
]);

const DEVELOPMENT_CARD_PLAY_COMMANDS = new Set([
  COMMAND_TYPES.PLAY_KNIGHT,
  COMMAND_TYPES.PLAY_ROAD_BUILDING,
  COMMAND_TYPES.PLAY_YEAR_OF_PLENTY,
  COMMAND_TYPES.PLAY_MONOPOLY,
]);

const TRADE_COMMANDS = new Set([
  COMMAND_TYPES.TRADE_WITH_BANK,
  COMMAND_TYPES.CREATE_TRADE,
  COMMAND_TYPES.RESPOND_TO_TRADE,
  COMMAND_TYPES.CONFIRM_TRADE,
  COMMAND_TYPES.CANCEL_TRADE,
]);

export function dispatchCommand(state, envelope) {
  if (envelope.gameId && envelope.gameId !== state.gameId) {
    return rejected(state, envelope, ERROR_CODES.GAME_NOT_FOUND, "Game does not exist.");
  }

  if (envelope.expectedVersion !== state.version) {
    return rejected(
      state,
      envelope,
      ERROR_CODES.VERSION_CONFLICT,
      `Expected version ${state.version}, received ${envelope.expectedVersion}.`,
    );
  }

  const validation = validateCommand(state, envelope.actorId, envelope.command);
  if (!validation.ok) {
    return rejected(state, envelope, validation.code, validation.message, validation.details);
  }

  const draft = structuredClone(state);
  draft.version = state.version + 1;
  const events = applyCommand(draft, envelope.actorId, envelope.command);

  return {
    state: draft,
    result: {
      commandId: envelope.commandId,
      accepted: true,
      version: draft.version,
      events,
      error: null,
    },
  };
}

export function createCommandEnvelope(state, actorId, command, commandId) {
  return {
    commandId: commandId || createId("command"),
    gameId: state.gameId,
    actorId,
    expectedVersion: state.version,
    command,
  };
}

export function createDefaultPlayers(playerCount = 4) {
  return Array.from({ length: playerCount }, (_, index) => ({
    name: DEFAULT_PLAYER_NAMES[index] || `Player ${index + 1}`,
    isBot: index > 0,
  }));
}

export function createGame(options = {}) {
  return createLobbyState({
    players: options.players || createDefaultPlayers(),
    seed: options.seed,
    gameId: options.gameId,
  });
}

export function validateCommand(state, actorId, command) {
  if (!command || typeof command.type !== "string") {
    return invalid(ERROR_CODES.UNKNOWN_COMMAND, "Command type is required.");
  }

  if (command.type === COMMAND_TYPES.START_GAME) {
    if (state.phase !== GAME_PHASES.LOBBY) {
      return invalid(ERROR_CODES.GAME_ALREADY_STARTED, "Game has already started.");
    }
    if (actorId !== 0) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "Only the host can start the game.");
    }
    if (state.players.length < 3 || state.players.length > 4) {
      return invalid(ERROR_CODES.INVALID_PLAYER_COUNT, "Base game requires 3 or 4 players.");
    }
    return valid();
  }

  const player = state.players[actorId];
  if (!player) {
    return invalid(ERROR_CODES.PLAYER_NOT_FOUND, "Player does not exist.");
  }

  if (state.trade && !TRADE_COMMANDS.has(command.type)) {
    return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already waiting for a response.");
  }

  if (command.type === COMMAND_TYPES.TRADE_WITH_BANK) {
    if (state.trade) {
      return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already open.");
    }
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Bank trade is only allowed after rolling.");
    }
    const giveResource = command.giveResource;
    const receiveResource = command.receiveResource;
    const giveAmount = Number(command.giveAmount);
    const receiveAmount = Number(command.receiveAmount);
    if (
      !RESOURCES.includes(giveResource) ||
      !RESOURCES.includes(receiveResource) ||
      giveResource === receiveResource ||
      !Number.isInteger(giveAmount) ||
      !Number.isInteger(receiveAmount) ||
      giveAmount <= 0 ||
      receiveAmount <= 0
    ) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Trade resources are invalid.");
    }
    const ratio = getBestTradeRatio(state, actorId, giveResource);
    if (giveAmount !== ratio * receiveAmount) {
      return invalid(ERROR_CODES.INVALID_TRADE_RATIO, `Bank trade ratio must be ${ratio}:1.`, {
        ratio,
      });
    }
    if (player.resources[giveResource] < giveAmount) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources to give.");
    }
    if (state.bank[receiveResource] < receiveAmount) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Bank does not have enough resources.", {
        resource: receiveResource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CREATE_TRADE) {
    if (state.trade) {
      return invalid(ERROR_CODES.TRADE_ALREADY_OPEN, "A trade is already open.");
    }
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Trade is only allowed after rolling.");
    }
    const offerValidation = validateTradePool(command.offer);
    if (!offerValidation.ok) return offerValidation;
    const requestValidation = validateTradePool(command.request);
    if (!requestValidation.ok) return requestValidation;
    for (const resource of RESOURCES) {
      if (player.resources[resource] < Number(command.offer[resource] || 0)) {
        return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, `Not enough ${resource} to offer.`);
      }
    }
    const targetPlayerIds = normalizeTradeTargets(state.players, actorId, command.targetPlayerIds);
    if (targetPlayerIds.length === 0) {
      return invalid(ERROR_CODES.INVALID_TRADE, "Trade requires at least one target.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.RESPOND_TO_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId === actorId || !state.trade.targetPlayerIds.includes(actorId)) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Player is not a target of this trade.");
    }
    if (state.trade.responses[actorId]) {
      return invalid(
        ERROR_CODES.TRADE_ALREADY_RESPONDED,
        "Player has already responded to this trade.",
      );
    }
    if (state.trade.currentResponderPlayerId !== actorId) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "Another player must respond to the trade first.",
      );
    }
    if (command.accepted && !canFulfillTradeRequest(state, actorId)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Player cannot fulfill this trade.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CONFIRM_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Only the creator can confirm this trade.");
    }
    if (
      Object.keys(state.trade.responses).length <
      state.trade.targetPlayerIds.length
    ) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "All trade targets must respond first.",
      );
    }
    const targetPlayerId = Number(command.partnerId);
    if (!state.trade.targetPlayerIds.includes(targetPlayerId)) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Partner is not a trade target.");
    }
    if (state.trade.responses[targetPlayerId] !== "ACCEPTED") {
      return invalid(ERROR_CODES.TRADE_TARGET_NOT_ACCEPTED, "Partner has not accepted the trade.");
    }
    if (!tradeResourcesStillAvailable(state, targetPlayerId)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Trade resources are no longer available.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CANCEL_TRADE) {
    if (!state.trade) return invalid(ERROR_CODES.TRADE_NOT_FOUND, "Trade does not exist.");
    if (state.trade.fromPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_TRADE_TARGET, "Only the creator can cancel this trade.");
    }
    if (
      Object.keys(state.trade.responses).length <
      state.trade.targetPlayerIds.length
    ) {
      return invalid(
        ERROR_CODES.TRADE_WAITING_FOR_RESPONSES,
        "All trade targets must respond first.",
      );
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.BUY_DEVELOPMENT_CARD) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Development cards can only be bought after rolling.");
    }
    if (state.developmentDeck.length === 0) {
      return invalid(ERROR_CODES.DEVELOPMENT_DECK_EMPTY, "The development deck is empty.");
    }
    if (!canAffordCost(player, DEVELOPMENT_CARD_COST)) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources to buy a card.", {
        cost: DEVELOPMENT_CARD_COST,
      });
    }
    return valid();
  }

  if (DEVELOPMENT_CARD_PLAY_COMMANDS.has(command.type)) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (
      state.phase !== GAME_PHASES.AWAITING_ROLL &&
      state.phase !== GAME_PHASES.TURN_ACTIONS
    ) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Development cards cannot be played now.");
    }
    const expectedType = developmentCardTypeForCommand(command.type);
    const cardValidation = validatePlayableDevelopmentCard(
      state,
      player,
      command.cardId,
      expectedType,
    );
    if (!cardValidation.ok) return cardValidation;

    if (
      command.type === COMMAND_TYPES.PLAY_ROAD_BUILDING &&
      !hasPieceAvailable(player, "road")
    ) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.");
    }
    if (
      command.type === COMMAND_TYPES.PLAY_MONOPOLY &&
      !RESOURCES.includes(command.resource)
    ) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Monopoly resource is invalid.", {
        resource: command.resource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.REVEAL_VICTORY_POINT) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (
      state.phase !== GAME_PHASES.AWAITING_ROLL &&
      state.phase !== GAME_PHASES.TURN_ACTIONS
    ) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Victory point cards cannot be revealed now.");
    }
    const card = player.developmentCards.find((candidate) => candidate.id === command.cardId);
    if (!card || card.type !== DEVELOPMENT_CARD_TYPES.VICTORY_POINT) {
      return invalid(ERROR_CODES.CARD_NOT_OWNED, "Victory point card was not found.");
    }
    if (card.revealed) {
      return invalid(ERROR_CODES.CARD_NOT_PLAYABLE, "Victory point card is already revealed.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.PLACE_FREE_ROAD) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_FREE_ROAD) {
      return invalid(ERROR_CODES.FREE_ROAD_NOT_AVAILABLE, "No free road is pending.");
    }
    const edgeId = Number(command.edgeId);
    const edge = state.board?.edges[edgeId];
    if (!edge) {
      return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
    }
    if (edge.road) {
      return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
    }
    if (!isRoadConnectedToPlayer(state.board, edgeId, actorId)) {
      return invalid(ERROR_CODES.ROAD_NOT_CONNECTED, "Free road must connect to this player's network.");
    }
    if (!hasPieceAvailable(state.players[actorId], "road")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CHOOSE_RESOURCE) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
      return invalid(ERROR_CODES.INVALID_PHASE, "No resource choice is pending.");
    }
    if (!RESOURCES.includes(command.resource)) {
      return invalid(ERROR_CODES.INVALID_RESOURCE, "Resource is invalid.", {
        resource: command.resource,
      });
    }
    if (state.bank[command.resource] <= 0) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Bank does not have that resource.", {
        resource: command.resource,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.DISCARD_RESOURCES) {
    if (state.phase !== GAME_PHASES.AWAITING_DISCARD) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The game is not waiting for discards.");
    }
    const required = state.pendingAction?.requiredByPlayer?.[actorId] || 0;
    if (required <= 0) {
      return invalid(ERROR_CODES.DISCARD_NOT_REQUIRED, "This player does not need to discard.");
    }
    const resources = command.resources || {};
    const total = RESOURCES.reduce(
      (sum, resource) => sum + Number(resources[resource] || 0),
      0,
    );
    if (total !== required) {
      return invalid(
        ERROR_CODES.DISCARD_COUNT_MISMATCH,
        `Player must discard exactly ${required} resources.`,
        { required, received: total },
      );
    }
    for (const resource of RESOURCES) {
      const amount = Number(resources[resource] || 0);
      if (!Number.isInteger(amount) || amount < 0) {
        return invalid(ERROR_CODES.DISCARD_COUNT_MISMATCH, "Discard amounts must be positive integers.");
      }
      if (amount > player.resources[resource]) {
        return invalid(
          ERROR_CODES.INSUFFICIENT_RESOURCES,
          `Player does not have enough ${resource}.`,
          { resource, amount, available: player.resources[resource] },
        );
      }
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.MOVE_ROBBER) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_ROBBER_MOVE) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The robber cannot be moved now.");
    }
    const hexId = Number(command.hexId);
    const hex = state.board?.hexes[hexId];
    if (!hex) {
      return invalid(ERROR_CODES.INVALID_HEX, "Hex does not exist.");
    }
    if (hexId === state.robberHexId) {
      return invalid(ERROR_CODES.ROBBER_SAME_HEX, "Robber must move to another hex.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.CHOOSE_STEAL_TARGET) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_STEAL_TARGET) {
      return invalid(ERROR_CODES.INVALID_PHASE, "A steal target cannot be chosen now.");
    }
    const targetPlayerId = Number(command.playerId);
    if (!state.pendingAction?.candidatePlayerIds?.includes(targetPlayerId)) {
      return invalid(
        ERROR_CODES.INVALID_STEAL_TARGET,
        "Target player is not a valid steal target.",
        { targetPlayerId },
      );
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.ROLL_DICE) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.turn.hasRolled) {
      return invalid(ERROR_CODES.ALREADY_ROLLED, "This player has already rolled.");
    }
    if (state.phase !== GAME_PHASES.AWAITING_ROLL) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The game is not waiting for a roll.");
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.END_TURN) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "The current player cannot end the turn yet.");
    }
    return valid();
  }

  if (BUILD_COMMANDS.has(command.type)) {
    if (state.currentPlayerId !== actorId) {
      return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's turn.");
    }
    if (state.phase !== GAME_PHASES.TURN_ACTIONS) {
      return invalid(ERROR_CODES.INVALID_PHASE, "Building is only allowed after rolling.");
    }
    return validateBuildCommand(state, actorId, command);
  }

  if (!SETUP_COMMANDS.has(command.type)) {
    return invalid(ERROR_CODES.UNKNOWN_COMMAND, `Unsupported command: ${command.type}`);
  }

  if (
    state.phase !== GAME_PHASES.SETUP_ROUND_1 &&
    state.phase !== GAME_PHASES.SETUP_ROUND_2
  ) {
    return invalid(ERROR_CODES.INVALID_PHASE, "Command is only valid during setup.");
  }

  if (state.currentPlayerId !== actorId) {
    return invalid(ERROR_CODES.NOT_YOUR_TURN, "It is not this player's setup turn.");
  }

  if (command.type === COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT) {
    if (state.setup.step !== SETUP_STEPS.SETTLEMENT) {
      return invalid(ERROR_CODES.INVALID_SETUP_STEP, "A road must be placed first.");
    }
    const vertexId = Number(command.vertexId);
    const vertex = state.board?.vertices[vertexId];
    if (!vertex) {
      return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
    }
    if (vertex.building) {
      return invalid(ERROR_CODES.OCCUPIED_VERTEX, "Vertex is already occupied.", { vertexId });
    }
    if (!isVertexFree(state.board, vertexId)) {
      return invalid(
        ERROR_CODES.DISTANCE_RULE_VIOLATION,
        "Settlement violates the distance rule.",
        { vertexId },
      );
    }
    return valid();
  }

  if (state.setup.step !== SETUP_STEPS.ROAD) {
    return invalid(ERROR_CODES.INVALID_SETUP_STEP, "A settlement must be placed first.");
  }

  const edgeId = Number(command.edgeId);
  const edge = state.board?.edges[edgeId];
  if (!edge) {
    return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
  }
  if (edge.road) {
    return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
  }
  const settlementVertexId = state.setup.lastSettlementVertexId;
  if (edge.v1 !== settlementVertexId && edge.v2 !== settlementVertexId) {
    return invalid(
      ERROR_CODES.ROAD_NOT_CONNECTED,
      "Initial road must connect to the settlement just placed.",
      { edgeId, settlementVertexId },
    );
  }
  return valid();
}

export function getValidCommands(state, playerId) {
  if (state.phase === GAME_PHASES.AWAITING_DISCARD) {
    const required = state.pendingAction?.requiredByPlayer?.[playerId] || 0;
    return required > 0
      ? [{ type: COMMAND_TYPES.DISCARD_RESOURCES, required }]
      : [];
  }

  if (state.phase === GAME_PHASES.AWAITING_FREE_ROAD) {
    if (state.currentPlayerId !== playerId) return [];
    return legalBuildRoadEdges(state.board, playerId).map((edgeId) => ({
      type: COMMAND_TYPES.PLACE_FREE_ROAD,
      edgeId,
    }));
  }

  if (state.phase === GAME_PHASES.AWAITING_RESOURCE_CHOICE) {
    if (state.currentPlayerId !== playerId) return [];
    return RESOURCES.filter((resource) => state.bank[resource] > 0).map((resource) => ({
      type: COMMAND_TYPES.CHOOSE_RESOURCE,
      resource,
    }));
  }

  if (state.trade) {
    if (state.trade.fromPlayerId === playerId) {
      if (
        Object.keys(state.trade.responses).length <
        state.trade.targetPlayerIds.length
      ) {
        return [];
      }
      return [
        ...state.trade.targetPlayerIds
          .filter(
            (targetPlayerId) =>
              state.trade.responses[targetPlayerId] === "ACCEPTED" &&
              tradeResourcesStillAvailable(state, targetPlayerId),
          )
          .map((partnerId) => ({
            type: COMMAND_TYPES.CONFIRM_TRADE,
            partnerId,
          })),
        { type: COMMAND_TYPES.CANCEL_TRADE },
      ];
    }
    if (
      state.trade.currentResponderPlayerId === playerId &&
      !state.trade.responses[playerId]
    ) {
      const commands = [
        { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: false },
      ];
      if (canFulfillTradeRequest(state, playerId)) {
        commands.unshift({ type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: true });
      }
      return commands;
    }
    return [];
  }

  if (state.currentPlayerId !== playerId) return [];
  if (state.phase === GAME_PHASES.GAME_OVER) return [];

  if (state.phase === GAME_PHASES.AWAITING_ROLL) {
    return state.board
      ? [
          { type: COMMAND_TYPES.ROLL_DICE },
          ...getPlayableDevelopmentCardCommands(state, state.players[playerId]),
        ]
      : [];
  }

  if (state.phase === GAME_PHASES.TURN_ACTIONS) {
    const player = state.players[playerId];
    const commands = [];

    if (canAfford(player, "road") && hasPieceAvailable(player, "road")) {
      commands.push(
        ...legalBuildRoadEdges(state.board, playerId).map((edgeId) => ({
          type: COMMAND_TYPES.BUILD_ROAD,
          edgeId,
        })),
      );
    }

    if (canAfford(player, "settlement") && hasPieceAvailable(player, "settlement")) {
      commands.push(
        ...legalBuildSettlementVertices(state.board, playerId).map((vertexId) => ({
          type: COMMAND_TYPES.BUILD_SETTLEMENT,
          vertexId,
        })),
      );
    }

    if (canAfford(player, "city") && hasPieceAvailable(player, "city")) {
      commands.push(
        ...legalBuildCityVertices(state.board, playerId).map((vertexId) => ({
          type: COMMAND_TYPES.BUILD_CITY,
          vertexId,
        })),
      );
    }

    if (
      state.developmentDeck.length > 0 &&
      canAffordCost(player, DEVELOPMENT_CARD_COST)
    ) {
      commands.push({ type: COMMAND_TYPES.BUY_DEVELOPMENT_CARD });
    }

    commands.push(...getPlayableDevelopmentCardCommands(state, player));
    commands.push(...getTradeCommands(state, player));
    commands.push({ type: COMMAND_TYPES.END_TURN });
    return commands;
  }

  if (state.phase === GAME_PHASES.AWAITING_ROBBER_MOVE) {
    return state.board.hexes
      .filter((hex) => hex.id !== state.robberHexId)
      .map((hex) => ({
        type: COMMAND_TYPES.MOVE_ROBBER,
        hexId: hex.id,
      }));
  }

  if (state.phase === GAME_PHASES.AWAITING_STEAL_TARGET) {
    return (state.pendingAction?.candidatePlayerIds || []).map((targetPlayerId) => ({
      type: COMMAND_TYPES.CHOOSE_STEAL_TARGET,
      playerId: targetPlayerId,
    }));
  }

  if (!state.board) return [];

  if (
    state.phase !== GAME_PHASES.SETUP_ROUND_1 &&
    state.phase !== GAME_PHASES.SETUP_ROUND_2
  ) {
    return [];
  }

  if (state.setup.step === SETUP_STEPS.SETTLEMENT) {
    return legalInitialSettlementVertices(state.board).map((vertexId) => ({
      type: COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT,
      vertexId,
    }));
  }

  return legalInitialRoadEdges(
    state.board,
    state.setup.lastSettlementVertexId,
  ).map((edgeId) => ({
    type: COMMAND_TYPES.PLACE_INITIAL_ROAD,
    edgeId,
  }));
}

function validateBuildCommand(state, playerId, command) {
  const player = state.players[playerId];

  if (command.type === COMMAND_TYPES.BUILD_ROAD) {
    const edgeId = Number(command.edgeId);
    const edge = state.board?.edges[edgeId];
    if (!edge) {
      return invalid(ERROR_CODES.INVALID_EDGE, "Edge does not exist.");
    }
    if (edge.road) {
      return invalid(ERROR_CODES.OCCUPIED_EDGE, "Edge already has a road.", { edgeId });
    }
    if (!isRoadConnectedToPlayer(state.board, edgeId, playerId)) {
      return invalid(
        ERROR_CODES.ROAD_NOT_CONNECTED,
        "Road must connect to this player's network.",
        { edgeId },
      );
    }
    if (!hasPieceAvailable(player, "road")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No roads remain.", {
        limit: PIECE_LIMITS.road,
      });
    }
    if (!canAfford(player, "road")) {
      return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources for a road.", {
        cost: BUILD_COSTS.road,
      });
    }
    return valid();
  }

  if (command.type === COMMAND_TYPES.BUILD_SETTLEMENT) {
    const vertexId = Number(command.vertexId);
    const vertex = state.board?.vertices[vertexId];
    if (!vertex) {
      return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
    }
    if (vertex.building) {
      return invalid(ERROR_CODES.OCCUPIED_VERTEX, "Vertex is already occupied.", { vertexId });
    }
    if (!isVertexFree(state.board, vertexId)) {
      return invalid(
        ERROR_CODES.DISTANCE_RULE_VIOLATION,
        "Settlement violates the distance rule.",
        { vertexId },
      );
    }
    const connected = vertex.edgeIds.some(
      (edgeId) => state.board.edges[edgeId].road?.playerId === playerId,
    );
    if (!connected) {
      return invalid(
        ERROR_CODES.ROAD_NOT_CONNECTED,
        "Settlement must connect to this player's road.",
        { vertexId },
      );
    }
    if (!hasPieceAvailable(player, "settlement")) {
      return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No settlements remain.", {
        limit: PIECE_LIMITS.settlement,
      });
    }
    if (!canAfford(player, "settlement")) {
      return invalid(
        ERROR_CODES.INSUFFICIENT_RESOURCES,
        "Not enough resources for a settlement.",
        { cost: BUILD_COSTS.settlement },
      );
    }
    return valid();
  }

  const vertexId = Number(command.vertexId);
  const vertex = state.board?.vertices[vertexId];
  if (!vertex) {
    return invalid(ERROR_CODES.INVALID_VERTEX, "Vertex does not exist.");
  }
  if (
    vertex.building?.playerId !== playerId ||
    vertex.building.type !== "settlement"
  ) {
    return invalid(ERROR_CODES.INVALID_BUILDING, "City must upgrade this player's settlement.", {
      vertexId,
    });
  }
  if (!hasPieceAvailable(player, "city")) {
    return invalid(ERROR_CODES.RESOURCE_LIMIT_REACHED, "No cities remain.", {
      limit: PIECE_LIMITS.city,
    });
  }
  if (!canAfford(player, "city")) {
    return invalid(ERROR_CODES.INSUFFICIENT_RESOURCES, "Not enough resources for a city.", {
      cost: BUILD_COSTS.city,
    });
  }
  return valid();
}

function canAfford(player, buildType) {
  return Object.entries(BUILD_COSTS[buildType]).every(
    ([resource, amount]) => player.resources[resource] >= amount,
  );
}

function canAffordCost(player, cost) {
  return Object.entries(cost).every(
    ([resource, amount]) => player.resources[resource] >= amount,
  );
}

function hasPieceAvailable(player, pieceType) {
  if (pieceType === "road") return player.roads.length < PIECE_LIMITS.road;
  if (pieceType === "settlement") {
    return player.settlements.length < PIECE_LIMITS.settlement;
  }
  return player.cities.length < PIECE_LIMITS.city;
}

function developmentCardTypeForCommand(commandType) {
  if (commandType === COMMAND_TYPES.PLAY_KNIGHT) {
    return DEVELOPMENT_CARD_TYPES.KNIGHT;
  }
  if (commandType === COMMAND_TYPES.PLAY_ROAD_BUILDING) {
    return DEVELOPMENT_CARD_TYPES.ROAD_BUILDING;
  }
  if (commandType === COMMAND_TYPES.PLAY_YEAR_OF_PLENTY) {
    return DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY;
  }
  return DEVELOPMENT_CARD_TYPES.MONOPOLY;
}

function validatePlayableDevelopmentCard(state, player, cardId, expectedType) {
  const card = player.developmentCards.find((candidate) => candidate.id === cardId);
  if (!card || card.type !== expectedType) {
    return invalid(ERROR_CODES.CARD_NOT_OWNED, "Development card was not found.");
  }
  if (player.newDevelopmentCards.includes(card.id)) {
    return invalid(
      ERROR_CODES.CARD_BOUGHT_THIS_TURN,
      "A newly bought card cannot be played this turn.",
    );
  }
  if (player.developmentCardPlayedThisTurn) {
    return invalid(
      ERROR_CODES.ONE_DEV_CARD_PER_TURN,
      "Only one development card can be played each turn.",
    );
  }
  return valid();
}

function getPlayableDevelopmentCardCommands(state, player) {
  const commands = [];

  for (const card of player.developmentCards) {
    if (
      card.type === DEVELOPMENT_CARD_TYPES.VICTORY_POINT &&
      !card.revealed
    ) {
      commands.push({
        type: COMMAND_TYPES.REVEAL_VICTORY_POINT,
        cardId: card.id,
      });
    }
  }

  if (player.developmentCardPlayedThisTurn) return commands;

  for (const card of player.developmentCards) {
    if (player.newDevelopmentCards.includes(card.id)) continue;

    if (card.type === DEVELOPMENT_CARD_TYPES.KNIGHT) {
      commands.push({ type: COMMAND_TYPES.PLAY_KNIGHT, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.ROAD_BUILDING) {
      commands.push({ type: COMMAND_TYPES.PLAY_ROAD_BUILDING, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY) {
      commands.push({ type: COMMAND_TYPES.PLAY_YEAR_OF_PLENTY, cardId: card.id });
    } else if (card.type === DEVELOPMENT_CARD_TYPES.MONOPOLY) {
      for (const resource of RESOURCES) {
        commands.push({
          type: COMMAND_TYPES.PLAY_MONOPOLY,
          cardId: card.id,
          resource,
        });
      }
    }
  }

  return commands;
}

function applyCommand(state, actorId, command) {
  if (command.type === COMMAND_TYPES.START_GAME) return applyStartGame(state);
  if (command.type === COMMAND_TYPES.PLACE_INITIAL_SETTLEMENT) {
    return applyPlaceInitialSettlement(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.PLACE_INITIAL_ROAD) {
    return applyPlaceInitialRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.ROLL_DICE) {
    return applyRollDice(state, actorId);
  }
  if (command.type === COMMAND_TYPES.END_TURN) {
    return applyEndTurn(state, actorId);
  }
  if (command.type === COMMAND_TYPES.BUILD_ROAD) {
    return applyBuildRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.BUILD_SETTLEMENT) {
    return applyBuildSettlement(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.BUILD_CITY) {
    return applyBuildCity(state, actorId, Number(command.vertexId));
  }
  if (command.type === COMMAND_TYPES.DISCARD_RESOURCES) {
    return applyDiscardResources(state, actorId, command.resources || {});
  }
  if (command.type === COMMAND_TYPES.MOVE_ROBBER) {
    return applyMoveRobber(state, actorId, Number(command.hexId));
  }
  if (command.type === COMMAND_TYPES.CHOOSE_STEAL_TARGET) {
    return applyChooseStealTarget(state, actorId, Number(command.playerId));
  }
  if (command.type === COMMAND_TYPES.BUY_DEVELOPMENT_CARD) {
    return applyBuyDevelopmentCard(state, actorId);
  }
  if (command.type === COMMAND_TYPES.PLAY_KNIGHT) {
    return applyPlayKnight(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_ROAD_BUILDING) {
    return applyPlayRoadBuilding(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_YEAR_OF_PLENTY) {
    return applyPlayYearOfPlenty(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.PLAY_MONOPOLY) {
    return applyPlayMonopoly(state, actorId, command.cardId, command.resource);
  }
  if (command.type === COMMAND_TYPES.PLACE_FREE_ROAD) {
    return applyPlaceFreeRoad(state, actorId, Number(command.edgeId));
  }
  if (command.type === COMMAND_TYPES.CHOOSE_RESOURCE) {
    return applyChooseResource(state, actorId, command.resource);
  }
  if (command.type === COMMAND_TYPES.REVEAL_VICTORY_POINT) {
    return applyRevealVictoryPoint(state, actorId, command.cardId);
  }
  if (command.type === COMMAND_TYPES.TRADE_WITH_BANK) {
    return applyTradeWithBank(state, actorId, command);
  }
  if (command.type === COMMAND_TYPES.CREATE_TRADE) {
    return applyCreateTrade(state, actorId, command);
  }
  if (command.type === COMMAND_TYPES.RESPOND_TO_TRADE) {
    return applyRespondToTrade(state, actorId, Boolean(command.accepted));
  }
  if (command.type === COMMAND_TYPES.CONFIRM_TRADE) {
    return applyConfirmTrade(state, actorId, Number(command.partnerId));
  }
  if (command.type === COMMAND_TYPES.CANCEL_TRADE) {
    return applyCancelTrade(state, actorId);
  }
  return [];
}

function applyRollDice(state, playerId) {
  const die1 = Math.floor(nextRandom(state) * 6) + 1;
  const die2 = Math.floor(nextRandom(state) * 6) + 1;
  const total = die1 + die2;
  state.turn.hasRolled = true;
  state.turn.dice = { die1, die2, total };

  const events = [
    appendEvent(state, EVENT_TYPES.DICE_ROLLED, {
      playerId,
      die1,
      die2,
      total,
    }),
  ];

  if (total === 7) {
    events.push(...beginSevenResolution(state, playerId));
    return events;
  }

  const production = resolveResourceProduction(state, total);
  state.turn.production = production.production;
  events.push(...production.events);

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.TURN_ACTIONS;
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.TURN_ACTIONS,
    }),
  );

  return events;
}

function resolveResourceProduction(state, total) {
  const events = [];
  const production = [];

  if (total === 7) {
    return { events, production };
  }

  const demandByResource = Object.fromEntries(
    RESOURCES.map((resource) => [
      resource,
      {
        total: 0,
        hexes: [],
      },
    ]),
  );

  for (const hex of [...state.board.hexes].sort((first, second) => first.id - second.id)) {
    if (hex.number !== total || !hex.resource || hex.id === state.robberHexId) continue;

    const gains = [];
    for (const vertexId of [...hex.vertexIds].sort((first, second) => first - second)) {
      const building = state.board.vertices[vertexId]?.building;
      if (!building) continue;

      const amount = building.type === "city" ? 2 : 1;
      gains.push({ playerId: building.playerId, amount });
      demandByResource[hex.resource].total += amount;
    }

    if (gains.length > 0) {
      gains.sort((first, second) => first.playerId - second.playerId);
      demandByResource[hex.resource].hexes.push({
        hexId: hex.id,
        resource: hex.resource,
        gains,
      });
    }
  }

  for (const resource of RESOURCES) {
    const demand = demandByResource[resource];
    if (demand.total === 0) continue;

    if (state.bank[resource] < demand.total) {
      events.push(
        appendEvent(state, EVENT_TYPES.BANK_RESOURCE_SHORTAGE, {
          resource,
          requested: demand.total,
          available: state.bank[resource],
        }),
      );
      continue;
    }

    state.bank[resource] -= demand.total;
    const playerGains = new Map();

    for (const hex of demand.hexes) {
      for (const gain of hex.gains) {
        const player = state.players[gain.playerId];
        player.resources[resource] += gain.amount;
        playerGains.set(gain.playerId, (playerGains.get(gain.playerId) || 0) + gain.amount);
      }
    }

    for (const hex of demand.hexes) {
      events.push(
        appendEvent(state, EVENT_TYPES.RESOURCES_PRODUCED, {
          hexId: hex.hexId,
          resource,
          gains: hex.gains,
        }),
      );
      production.push(hex);
    }

    for (const [playerId, amount] of [...playerGains.entries()].sort(
      (first, second) => first[0] - second[0],
    )) {
      const gained = createResourcePool();
      gained[resource] = amount;
      events.push(
        appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
          playerId,
          resources: gained,
          source: "DICE_ROLL",
        }),
        appendEvent(
          state,
          EVENT_TYPES.HAND_CHANGED,
          {
            playerId,
            resources: { ...state.players[playerId].resources },
            reason: "DICE_ROLL",
          },
          "PLAYER",
          playerId,
        ),
      );
    }
  }

  return { events, production };
}

function applyEndTurn(state, playerId) {
  const currentIndex = state.players.findIndex((player) => player.id === playerId);
  const nextIndex = (currentIndex + 1) % state.players.length;
  const nextPlayerId = state.players[nextIndex].id;

  const events = [
    appendEvent(state, EVENT_TYPES.TURN_ENDED, {
      playerId,
      turnNumber: state.turnNumber,
    }),
  ];

  state.currentPlayerId = nextPlayerId;
  state.turn = {
    hasRolled: false,
    dice: null,
    production: [],
  };
  for (const player of state.players) {
    player.newDevelopmentCards = [];
    player.developmentCardPlayedThisTurn = false;
  }
  state.pendingAction = null;
  state.trade = null;
  state.phase = GAME_PHASES.AWAITING_ROLL;
  if (nextIndex === 0) state.turnNumber += 1;

  events.push(
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: nextPlayerId,
      turnNumber: state.turnNumber,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: GAME_PHASES.TURN_ACTIONS,
      to: GAME_PHASES.AWAITING_ROLL,
    }),
  );

  return events;
}

function beginSevenResolution(state, activePlayerId) {
  const requiredByPlayer = {};
  for (const player of state.players) {
    const count = countResources(player);
    if (count > 7) requiredByPlayer[player.id] = Math.floor(count / 2);
  }

  if (Object.keys(requiredByPlayer).length === 0) {
    return beginRobberMovePhase(state, activePlayerId, GAME_PHASES.AWAITING_ROLL);
  }

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.AWAITING_DISCARD;
  state.pendingAction = {
    type: "DISCARD",
    playerId: activePlayerId,
    requiredByPlayer,
    resumePhase: GAME_PHASES.TURN_ACTIONS,
  };

  const events = [];
  for (const [playerId, required] of Object.entries(requiredByPlayer)) {
    const numericPlayerId = Number(playerId);
    events.push(
      appendEvent(
        state,
        EVENT_TYPES.DISCARD_REQUIRED,
        {
          playerId: numericPlayerId,
          required,
        },
        "PLAYER",
        numericPlayerId,
      ),
      appendEvent(state, EVENT_TYPES.DISCARD_COUNT_CHANGED, {
        playerId: numericPlayerId,
        required,
        remaining: required,
      }),
    );
  }
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_DISCARD,
    }),
  );
  return events;
}

function beginRobberMovePhase(
  state,
  playerId,
  fromPhase,
  resumePhase = GAME_PHASES.TURN_ACTIONS,
) {
  state.phase = GAME_PHASES.AWAITING_ROBBER_MOVE;
  state.pendingAction = {
    type: "ROBBER_MOVE",
    playerId,
    resumePhase,
  };

  return [
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: fromPhase,
      to: GAME_PHASES.AWAITING_ROBBER_MOVE,
    }),
  ];
}

function applyDiscardResources(state, playerId, resources) {
  const player = state.players[playerId];
  const required = state.pendingAction.requiredByPlayer[playerId];
  const discarded = createResourcePool();

  for (const resource of RESOURCES) {
    const amount = Number(resources[resource] || 0);
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    discarded[resource] = amount;
  }

  delete state.pendingAction.requiredByPlayer[playerId];
  const events = [
    appendEvent(
      state,
      EVENT_TYPES.RESOURCES_DISCARDED,
      {
        playerId,
        resources: discarded,
        required,
      },
      "PLAYER",
      playerId,
    ),
    appendEvent(state, EVENT_TYPES.DISCARD_COUNT_CHANGED, {
      playerId,
      required,
      remaining: 0,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "DISCARD_RESOURCES",
      },
      "PLAYER",
      playerId,
    ),
  ];

  if (Object.keys(state.pendingAction.requiredByPlayer).length === 0) {
    const activePlayerId = state.pendingAction.playerId;
    state.pendingAction = null;
    events.push(
      ...beginRobberMovePhase(state, activePlayerId, GAME_PHASES.AWAITING_DISCARD),
    );
  }

  return events;
}

function applyMoveRobber(state, playerId, hexId) {
  const previousHexId = state.robberHexId;
  state.robberHexId = hexId;

  const events = [
    appendEvent(state, EVENT_TYPES.ROBBER_MOVED, {
      hexId,
      previousHexId,
      movedByPlayerId: playerId,
    }),
  ];
  const candidates = getStealCandidates(state, playerId, hexId);

  if (candidates.length === 0) {
    events.push(...finishRobberResolution(state));
    return events;
  }

  if (candidates.length === 1) {
    events.push(...resolveSteal(state, playerId, candidates[0]));
    return events;
  }

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.AWAITING_STEAL_TARGET;
  state.pendingAction = {
    type: "STEAL_TARGET",
    playerId,
    candidatePlayerIds: candidates,
    resumePhase: GAME_PHASES.TURN_ACTIONS,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_STEAL_TARGET,
    }),
  );
  return events;
}

function applyChooseStealTarget(state, playerId, targetPlayerId) {
  return resolveSteal(state, playerId, targetPlayerId);
}

function getStealCandidates(state, activePlayerId, hexId) {
  const candidates = new Set();
  const hex = state.board.hexes[hexId];

  for (const vertexId of hex.vertexIds) {
    const building = state.board.vertices[vertexId]?.building;
    if (!building || building.playerId === activePlayerId) continue;
    if (countResources(state.players[building.playerId]) > 0) {
      candidates.add(building.playerId);
    }
  }

  return [...candidates].sort((first, second) => first - second);
}

function resolveSteal(state, thiefId, victimId) {
  const victim = state.players[victimId];
  const thief = state.players[thiefId];
  const available = RESOURCES.filter((resource) => victim.resources[resource] > 0);
  const events = [];

  if (available.length > 0) {
    const resource = available[Math.floor(nextRandom(state) * available.length)];
    victim.resources[resource] -= 1;
    thief.resources[resource] += 1;

    events.push(
      appendEvent(
        state,
        EVENT_TYPES.RESOURCE_LOST,
        {
          victimId,
          thiefId,
          resource,
        },
        "PLAYER",
        victimId,
      ),
      appendEvent(
        state,
        EVENT_TYPES.RESOURCE_STOLEN,
        {
          victimId,
          thiefId,
          resource,
        },
        "PLAYER",
        thiefId,
      ),
      appendEvent(state, EVENT_TYPES.STEAL_RESOLVED, {
        victimId,
        thiefId,
        resourceHidden: true,
      }),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: victimId,
          resources: { ...victim.resources },
          reason: "RESOURCE_STOLEN",
        },
        "PLAYER",
        victimId,
      ),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: thiefId,
          resources: { ...thief.resources },
          reason: "RESOURCE_STOLEN",
        },
        "PLAYER",
        thiefId,
      ),
    );
  }

  events.push(...finishRobberResolution(state));
  return events;
}

function finishRobberResolution(state) {
  const previousPhase = state.phase;
  const resumePhase = state.pendingAction?.resumePhase || GAME_PHASES.TURN_ACTIONS;
  state.pendingAction = null;
  state.phase = resumePhase;

  return [
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: resumePhase,
    }),
  ];
}

function countResources(player) {
  return Object.values(player.resources).reduce((total, amount) => total + amount, 0);
}

function getBestTradeRatio(state, playerId, resource) {
  const player = state.players[playerId];
  let ratio = 4;

  for (const vertexId of [...player.settlements, ...player.cities]) {
    const harbor = state.board.vertices[vertexId]?.harbor;
    if (harbor === resource) return 2;
    if (harbor === "any") ratio = Math.min(ratio, 3);
  }
  return ratio;
}

function getTradeCommands(state, player) {
  const commands = [];

  for (const giveResource of RESOURCES) {
    const ratio = getBestTradeRatio(state, player.id, giveResource);
    if (player.resources[giveResource] < ratio) continue;
    for (const receiveResource of RESOURCES) {
      if (receiveResource === giveResource || state.bank[receiveResource] <= 0) continue;
      commands.push({
        type: COMMAND_TYPES.TRADE_WITH_BANK,
        giveResource,
        giveAmount: ratio,
        receiveResource,
        receiveAmount: 1,
      });
    }
  }

  const targetPlayerIds = state.players
    .filter((candidate) => candidate.id !== player.id)
    .map((candidate) => candidate.id);
  for (const giveResource of RESOURCES) {
    if (player.resources[giveResource] <= 0) continue;
    const giveAmounts = [1];
    for (
      let amount = 2;
      amount <= Math.min(3, player.resources[giveResource]);
      amount += 1
    ) {
      giveAmounts.push(amount);
    }
    for (const requestResource of RESOURCES) {
      if (requestResource === giveResource) continue;
      for (const giveAmount of giveAmounts) {
        commands.push({
          type: COMMAND_TYPES.CREATE_TRADE,
          offer: { [giveResource]: giveAmount },
          request: { [requestResource]: 1 },
          targetPlayerIds,
        });
      }
    }
  }

  return commands;
}

function validateTradePool(pool) {
  if (!pool || typeof pool !== "object") {
    return invalid(ERROR_CODES.INVALID_TRADE, "Trade resources are required.");
  }

  let total = 0;
  for (const [resource, rawAmount] of Object.entries(pool)) {
    const amount = Number(rawAmount);
    if (!RESOURCES.includes(resource) || !Number.isInteger(amount) || amount < 0) {
      return invalid(ERROR_CODES.INVALID_TRADE, "Trade resource amount is invalid.");
    }
    total += amount;
  }
  if (total <= 0) {
    return invalid(ERROR_CODES.INVALID_TRADE, "Trade must include at least one resource.");
  }
  return valid();
}

function normalizeTradeTargets(players, actorId, targetPlayerIds) {
  const requested = Array.isArray(targetPlayerIds)
    ? targetPlayerIds.map(Number)
    : players.filter((player) => player.id !== actorId).map((player) => player.id);
  const unique = [...new Set(requested)];
  if (
    unique.some(
      (playerId) =>
        !Number.isInteger(playerId) ||
        playerId === actorId ||
        !players.some((player) => player.id === playerId),
    )
  ) {
    return [];
  }
  return unique;
}

function tradeResourcesStillAvailable(state, targetPlayerId) {
  const trade = state.trade;
  const fromPlayer = state.players[trade.fromPlayerId];
  const targetPlayer = state.players[targetPlayerId];
  return (
    RESOURCES.every(
      (resource) => fromPlayer.resources[resource] >= Number(trade.offer[resource] || 0),
    ) &&
    RESOURCES.every(
      (resource) => targetPlayer.resources[resource] >= Number(trade.request[resource] || 0),
    )
  );
}

function canFulfillTradeRequest(state, playerId) {
  const trade = state.trade;
  const player = state.players[playerId];
  return RESOURCES.every(
    (resource) => player.resources[resource] >= Number(trade.request[resource] || 0),
  );
}

function applyTradeWithBank(state, playerId, command) {
  const player = state.players[playerId];
  const giveAmount = Number(command.giveAmount);
  const receiveAmount = Number(command.receiveAmount);
  const give = createResourcePool();
  const receive = createResourcePool();
  give[command.giveResource] = giveAmount;
  receive[command.receiveResource] = receiveAmount;
  player.resources[command.giveResource] -= giveAmount;
  state.bank[command.giveResource] += giveAmount;
  state.bank[command.receiveResource] -= receiveAmount;
  player.resources[command.receiveResource] += receiveAmount;

  return [
    appendEvent(state, EVENT_TYPES.BANK_TRADE_COMPLETED, {
      playerId,
      give,
      receive,
      ratio: giveAmount / receiveAmount,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "TRADE_WITH_BANK",
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function applyCreateTrade(state, playerId, command) {
  const targetPlayerIds = normalizeTradeTargets(
    state.players,
    playerId,
    command.targetPlayerIds,
  );
  state.trade = {
    tradeId: createId("trade"),
    fromPlayerId: playerId,
    offer: { ...command.offer },
    request: { ...command.request },
    targetPlayerIds,
    responses: {},
    currentResponderPlayerId:
      targetPlayerIds.length > 0 ? targetPlayerIds[0] : null,
  };

  return [
    appendEvent(state, EVENT_TYPES.TRADE_CREATED, {
      tradeId: state.trade.tradeId,
      fromPlayerId: playerId,
      offer: { ...state.trade.offer },
      request: { ...state.trade.request },
      targets: [...targetPlayerIds],
    }),
  ];
}

function applyRespondToTrade(state, playerId, accepted) {
  state.trade.responses[playerId] = accepted ? "ACCEPTED" : "REJECTED";
  const currentIndex = state.trade.targetPlayerIds.indexOf(playerId);
  state.trade.currentResponderPlayerId =
    state.trade.targetPlayerIds[currentIndex + 1] ?? null;
  const events = [
    appendEvent(state, EVENT_TYPES.TRADE_RESPONSE_RECORDED, {
      tradeId: state.trade.tradeId,
      playerId,
      accepted,
    }),
  ];
  if (state.trade.currentResponderPlayerId === null) {
    events.push(
      appendEvent(state, EVENT_TYPES.TRADE_ROUND_COMPLETED, {
        tradeId: state.trade.tradeId,
        acceptedPlayerIds: Object.entries(state.trade.responses)
          .filter(([, response]) => response === "ACCEPTED")
          .map(([responderId]) => Number(responderId)),
      }),
    );
  }
  return events;
}

function applyConfirmTrade(state, playerId, targetPlayerId) {
  const trade = state.trade;
  const fromPlayer = state.players[playerId];
  const targetPlayer = state.players[targetPlayerId];
  const exchange = {
    offer: { ...trade.offer },
    request: { ...trade.request },
  };

  for (const resource of RESOURCES) {
    const offerAmount = Number(trade.offer[resource] || 0);
    const requestAmount = Number(trade.request[resource] || 0);
    fromPlayer.resources[resource] -= offerAmount;
    targetPlayer.resources[resource] += offerAmount;
    targetPlayer.resources[resource] -= requestAmount;
    fromPlayer.resources[resource] += requestAmount;
  }

  state.trade = null;
  return [
    appendEvent(state, EVENT_TYPES.TRADE_COMPLETED, {
      tradeId: trade.tradeId,
      participants: [playerId, targetPlayerId],
      exchange,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...fromPlayer.resources },
        reason: "TRADE_COMPLETED",
      },
      "PLAYER",
      playerId,
    ),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId: targetPlayerId,
        resources: { ...targetPlayer.resources },
        reason: "TRADE_COMPLETED",
      },
      "PLAYER",
      targetPlayerId,
    ),
  ];
}

function applyCancelTrade(state, playerId) {
  const tradeId = state.trade.tradeId;
  const offer = { ...state.trade.offer };
  const request = { ...state.trade.request };
  const targetPlayerIds = [...state.trade.targetPlayerIds];
  const responses = { ...state.trade.responses };
  state.trade = null;
  return [
    appendEvent(state, EVENT_TYPES.TRADE_CANCELLED, {
      tradeId,
      playerId,
      offer,
      request,
      targetPlayerIds,
      responses,
    }),
  ];
}

function createDevelopmentDeck(state) {
  const cards = [];
  for (const [type, count] of Object.entries(DEVELOPMENT_CARD_COUNTS)) {
    for (let index = 0; index < count; index += 1) {
      cards.push({
        id: `card-${state.developmentCardSequence}`,
        type,
        revealed: false,
      });
      state.developmentCardSequence += 1;
    }
  }
  return shuffle(cards, () => nextRandom(state));
}

function applyBuyDevelopmentCard(state, playerId) {
  const player = state.players[playerId];
  const card = state.developmentDeck.pop();
  const events = [
    ...spendCost(
      state,
      playerId,
      DEVELOPMENT_CARD_COST,
      "BUY_DEVELOPMENT_CARD",
      "developmentCard",
    ),
  ];

  player.developmentCards.push(card);
  player.newDevelopmentCards.push(card.id);
  events.push(
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PURCHASED, {
      playerId,
      remaining: state.developmentDeck.length,
    }),
    appendEvent(
      state,
      EVENT_TYPES.DEVELOPMENT_CARD_DRAWN,
      {
        playerId,
        card: structuredClone(card),
      },
      "PLAYER",
      playerId,
    ),
  );
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyPlayKnight(state, playerId, cardId) {
  const player = state.players[playerId];
  const card = removePlayedDevelopmentCard(player, cardId);
  const previousPhase = state.phase;
  player.knightsPlayed += 1;
  player.developmentCardPlayedThisTurn = true;

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.KNIGHT,
    }),
  ];
  events.push(...updateLargestArmyAward(state, playerId));
  events.push(...checkForWinner(state, playerId));

  if (state.phase !== GAME_PHASES.GAME_OVER) {
    events.push(
      ...beginRobberMovePhase(
        state,
        playerId,
        previousPhase,
        previousPhase,
      ),
    );
  }
  return events;
}

function applyPlayRoadBuilding(state, playerId, cardId) {
  removePlayedDevelopmentCard(state.players[playerId], cardId);
  state.players[playerId].developmentCardPlayedThisTurn = true;
  const previousPhase = state.phase;
  const remaining = Math.min(2, PIECE_LIMITS.road - state.players[playerId].roads.length);

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.ROAD_BUILDING,
    }),
    appendEvent(state, EVENT_TYPES.ROAD_BUILDING_STARTED, {
      playerId,
      roadsRemaining: remaining,
    }),
  ];

  if (remaining <= 0 || legalBuildRoadEdges(state.board, playerId).length === 0) {
    return events;
  }

  state.phase = GAME_PHASES.AWAITING_FREE_ROAD;
  state.pendingAction = {
    type: "FREE_ROAD",
    playerId,
    roadsRemaining: remaining,
    resumePhase: previousPhase,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_FREE_ROAD,
    }),
  );
  return events;
}

function applyPlaceFreeRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);
  state.pendingAction.roadsRemaining -= 1;

  const events = [
    appendEvent(state, EVENT_TYPES.FREE_ROAD_PLACED, {
      playerId,
      edgeId,
      roadsRemaining: state.pendingAction.roadsRemaining,
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  events.push(...checkForWinner(state, playerId));

  if (state.phase === GAME_PHASES.GAME_OVER) return events;

  const noLegalRoads = legalBuildRoadEdges(state.board, playerId).length === 0;
  if (state.pendingAction.roadsRemaining <= 0 || noLegalRoads) {
    const resumePhase = state.pendingAction.resumePhase;
    state.pendingAction = null;
    state.phase = resumePhase;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.AWAITING_FREE_ROAD,
        to: resumePhase,
      }),
    );
  }
  return events;
}

function applyPlayYearOfPlenty(state, playerId, cardId) {
  removePlayedDevelopmentCard(state.players[playerId], cardId);
  state.players[playerId].developmentCardPlayedThisTurn = true;
  const previousPhase = state.phase;
  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.YEAR_OF_PLENTY,
    }),
  ];
  const choicesRemaining = Math.min(
    2,
    RESOURCES.reduce((total, resource) => total + state.bank[resource], 0),
  );

  events.push(
    appendEvent(state, EVENT_TYPES.YEAR_OF_PLENTY_STARTED, {
      playerId,
      choicesRemaining,
    }),
  );
  if (choicesRemaining <= 0) return events;

  state.phase = GAME_PHASES.AWAITING_RESOURCE_CHOICE;
  state.pendingAction = {
    type: "YEAR_OF_PLENTY",
    playerId,
    choicesRemaining,
    resumePhase: previousPhase,
  };
  events.push(
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.AWAITING_RESOURCE_CHOICE,
    }),
  );
  return events;
}

function applyChooseResource(state, playerId, resource) {
  const player = state.players[playerId];
  state.bank[resource] -= 1;
  player.resources[resource] += 1;
  state.pendingAction.choicesRemaining -= 1;
  const gained = createResourcePool();
  gained[resource] = 1;

  const events = [
    appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
      playerId,
      resources: gained,
      source: "YEAR_OF_PLENTY",
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "YEAR_OF_PLENTY",
      },
      "PLAYER",
      playerId,
    ),
  ];

  const noResourcesLeft = RESOURCES.every((candidate) => state.bank[candidate] <= 0);
  if (state.pendingAction.choicesRemaining <= 0 || noResourcesLeft) {
    const resumePhase = state.pendingAction.resumePhase;
    state.pendingAction = null;
    state.phase = resumePhase;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.AWAITING_RESOURCE_CHOICE,
        to: resumePhase,
      }),
    );
  }
  return events;
}

function applyPlayMonopoly(state, playerId, cardId, resource) {
  const player = state.players[playerId];
  removePlayedDevelopmentCard(player, cardId);
  player.developmentCardPlayedThisTurn = true;
  const gains = [];

  for (const opponent of state.players) {
    if (opponent.id === playerId) continue;
    const amount = opponent.resources[resource];
    if (amount <= 0) continue;
    opponent.resources[resource] = 0;
    player.resources[resource] += amount;
    gains.push({ playerId: opponent.id, amount });
  }

  const events = [
    appendEvent(state, EVENT_TYPES.DEVELOPMENT_CARD_PLAYED, {
      playerId,
      cardType: DEVELOPMENT_CARD_TYPES.MONOPOLY,
    }),
    appendEvent(state, EVENT_TYPES.MONOPOLY_RESOLVED, {
      playerId,
      resource,
      gains,
    }),
  ];

  for (const gain of gains) {
    events.push(
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: gain.playerId,
          resources: { ...state.players[gain.playerId].resources },
          reason: "MONOPOLY",
        },
        "PLAYER",
        gain.playerId,
      ),
    );
  }
  events.push(
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: "MONOPOLY",
      },
      "PLAYER",
      playerId,
    ),
  );
  return events;
}

function applyRevealVictoryPoint(state, playerId, cardId) {
  const player = state.players[playerId];
  const card = player.developmentCards.find((candidate) => candidate.id === cardId);
  card.revealed = true;

  const events = [
    appendEvent(state, EVENT_TYPES.VICTORY_POINT_REVEALED, {
      playerId,
      cardId,
      value: 1,
    }),
  ];
  events.push(...checkForWinner(state, playerId));
  return events;
}

function removePlayedDevelopmentCard(player, cardId) {
  const index = player.developmentCards.findIndex((card) => card.id === cardId);
  const [card] = player.developmentCards.splice(index, 1);
  return card;
}

function updateLargestArmyAward(state, playerId) {
  const currentHolder = state.awards.largestArmy;
  const player = state.players[playerId];
  if (player.knightsPlayed < 3) return [];

  let nextHolder = currentHolder;
  if (currentHolder === null) {
    const maxKnights = Math.max(...state.players.map((candidate) => candidate.knightsPlayed));
    const leaders = state.players.filter(
      (candidate) => candidate.knightsPlayed === maxKnights,
    );
    if (maxKnights >= 3 && leaders.length === 1) {
      nextHolder = leaders[0].id;
    }
  } else {
    const currentKnights = state.players[currentHolder].knightsPlayed;
    if (player.knightsPlayed > currentKnights) {
      const maxKnights = Math.max(...state.players.map((candidate) => candidate.knightsPlayed));
      const leaders = state.players.filter(
        (candidate) => candidate.knightsPlayed === maxKnights,
      );
      if (leaders.length === 1 && leaders[0].id === playerId) {
        nextHolder = playerId;
      }
    }
  }

  if (nextHolder === currentHolder) return [];
  state.awards.largestArmy = nextHolder;
  return [
    appendEvent(state, EVENT_TYPES.LARGEST_ARMY_CHANGED, {
      previousPlayerId: currentHolder,
      newPlayerId: nextHolder,
      size: state.players[nextHolder].knightsPlayed,
    }),
  ];
}

function updateLongestRoadAward(state) {
  const lengths = state.players.map((player) => ({
    playerId: player.id,
    length: calculateLongestRoadLength(state.board, player.id),
  }));
  const currentHolder = state.awards.longestRoad;
  const currentLength = currentHolder === null
    ? 0
    : lengths.find((entry) => entry.playerId === currentHolder).length;
  const maxLength = Math.max(...lengths.map((entry) => entry.length));
  const leaders = lengths.filter((entry) => entry.length === maxLength);
  let nextHolder = currentHolder;

  if (currentHolder !== null && currentLength < 5) {
    nextHolder = null;
  }

  if (nextHolder === null) {
    if (maxLength >= 5 && leaders.length === 1) nextHolder = leaders[0].playerId;
  } else {
    const holderLength = lengths.find((entry) => entry.playerId === nextHolder).length;
    if (maxLength > holderLength && leaders.length === 1) {
      nextHolder = leaders[0].playerId;
    }
  }

  if (nextHolder === currentHolder) return [];
  state.awards.longestRoad = nextHolder;
  return [
    appendEvent(state, EVENT_TYPES.LONGEST_ROAD_CHANGED, {
      previousPlayerId: currentHolder,
      newPlayerId: nextHolder,
      length: nextHolder === null
        ? 0
        : lengths.find((entry) => entry.playerId === nextHolder).length,
    }),
  ];
}

function spendCost(state, playerId, cost, reason, source) {
  const player = state.players[playerId];
  const spent = createResourcePool();

  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    spent[resource] = amount;
  }

  return [
    appendEvent(state, EVENT_TYPES.RESOURCES_SPENT, {
      playerId,
      resources: spent,
      buildType: source,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason,
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function applyBuildRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);

  const events = [
    ...spendResources(state, playerId, "road"),
    appendEvent(state, EVENT_TYPES.ROAD_PLACED, {
      playerId,
      edgeId,
      isInitial: false,
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyBuildSettlement(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  vertex.building = { playerId, type: "settlement" };
  player.settlements.push(vertexId);

  const victoryPoints = calculatePublicVictoryPoints(state, playerId);
  const events = [
    ...spendResources(state, playerId, "settlement"),
    appendEvent(state, EVENT_TYPES.SETTLEMENT_PLACED, {
      playerId,
      vertexId,
      isInitial: false,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.VICTORY_POINTS_CHANGED, {
      playerId,
      value: victoryPoints,
      reason: "BUILD_SETTLEMENT",
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  if (state.awards.longestRoad !== null) {
    events.push(...checkForWinner(state, state.awards.longestRoad));
  }
  events.push(...checkForWinner(state, playerId));
  return events;
}

function applyBuildCity(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  player.settlements = player.settlements.filter((settlementId) => settlementId !== vertexId);
  player.cities.push(vertexId);
  vertex.building = { playerId, type: "city" };

  const victoryPoints = calculatePublicVictoryPoints(state, playerId);
  const events = [
    ...spendResources(state, playerId, "city"),
    appendEvent(state, EVENT_TYPES.CITY_PLACED, {
      playerId,
      vertexId,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.VICTORY_POINTS_CHANGED, {
      playerId,
      value: victoryPoints,
      reason: "BUILD_CITY",
    }),
  ];
  events.push(...updateLongestRoadAward(state, playerId));
  if (state.awards.longestRoad !== null) {
    events.push(...checkForWinner(state, state.awards.longestRoad));
  }
  events.push(...checkForWinner(state, playerId));
  return events;
}

function spendResources(state, playerId, buildType) {
  const player = state.players[playerId];
  const cost = BUILD_COSTS[buildType];
  const spent = createResourcePool();

  for (const [resource, amount] of Object.entries(cost)) {
    player.resources[resource] -= amount;
    state.bank[resource] += amount;
    spent[resource] = amount;
  }

  return [
    appendEvent(state, EVENT_TYPES.RESOURCES_SPENT, {
      playerId,
      resources: spent,
      buildType,
    }),
    appendEvent(
      state,
      EVENT_TYPES.HAND_CHANGED,
      {
        playerId,
        resources: { ...player.resources },
        reason: `BUILD_${buildType.toUpperCase()}`,
      },
      "PLAYER",
      playerId,
    ),
  ];
}

function checkForWinner(state, playerId) {
  const victoryPoints = calculateVictoryPoints(state, playerId);
  if (victoryPoints < VICTORY_POINTS_TO_WIN || state.winnerId !== null) return [];

  const previousPhase = state.phase;
  state.phase = GAME_PHASES.GAME_OVER;
  state.winnerId = playerId;
  const revealedCards = [];
  for (const card of state.players[playerId].developmentCards) {
    if (card.type !== DEVELOPMENT_CARD_TYPES.VICTORY_POINT || card.revealed) continue;
    card.revealed = true;
    revealedCards.push(
      appendEvent(state, EVENT_TYPES.VICTORY_POINT_REVEALED, {
        playerId,
        cardId: card.id,
        value: 1,
      }),
    );
  }

  return [
    ...revealedCards,
    appendEvent(state, EVENT_TYPES.GAME_ENDED, {
      winnerId: playerId,
      victoryPoints,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: previousPhase,
      to: GAME_PHASES.GAME_OVER,
    }),
  ];
}

function applyStartGame(state) {
  state.board = generateBoard(state.seed);
  state.developmentDeck = createDevelopmentDeck(state);
  state.awards = {
    longestRoad: null,
    largestArmy: null,
  };
  for (const player of state.players) {
    player.developmentCards = [];
    player.newDevelopmentCards = [];
    player.developmentCardPlayedThisTurn = false;
    player.knightsPlayed = 0;
  }
  state.setup.order = createSetupOrder(state.players.length);
  state.setup.index = 0;
  state.setup.step = SETUP_STEPS.SETTLEMENT;
  state.setup.lastSettlementVertexId = null;
  state.phase = GAME_PHASES.SETUP_ROUND_1;
  state.currentPlayerId = state.setup.order[0];
  state.robberHexId = state.board.robberHexId;
  state.pendingAction = null;
  state.trade = null;

  const events = [
    appendEvent(state, EVENT_TYPES.GAME_STARTED, {
      playerIds: state.players.map((player) => player.id),
      seed: state.seed,
    }),
    appendEvent(state, EVENT_TYPES.BOARD_CREATED, {
      hexCount: state.board.hexes.length,
      harborCount: state.board.harbors.length,
    }),
    appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
      from: GAME_PHASES.LOBBY,
      to: GAME_PHASES.SETUP_ROUND_1,
    }),
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: state.currentPlayerId,
      setupIndex: state.setup.index,
    }),
  ];

  events.push(...grantStartingResources(state));
  return events;
}

function grantStartingResources(state) {
  const gained = createResourcePool(STARTING_RESOURCES_PER_TYPE);
  const events = [];

  for (const resource of RESOURCES) {
    state.bank[resource] -= state.players.length * STARTING_RESOURCES_PER_TYPE;
  }

  for (const player of state.players) {
    for (const resource of RESOURCES) {
      player.resources[resource] += STARTING_RESOURCES_PER_TYPE;
    }
    events.push(
      appendEvent(state, EVENT_TYPES.RESOURCES_GAINED, {
        playerId: player.id,
        resources: { ...gained },
        source: "STARTING_RESOURCES",
      }),
      appendEvent(
        state,
        EVENT_TYPES.HAND_CHANGED,
        {
          playerId: player.id,
          resources: { ...player.resources },
          reason: "STARTING_RESOURCES",
        },
        "PLAYER",
        player.id,
      ),
    );
  }

  return events;
}

function applyPlaceInitialSettlement(state, playerId, vertexId) {
  const player = state.players[playerId];
  const vertex = state.board.vertices[vertexId];
  vertex.building = { playerId, type: "settlement" };
  player.settlements.push(vertexId);
  state.setup.lastSettlementVertexId = vertexId;
  state.setup.step = SETUP_STEPS.ROAD;

  const events = [
    appendEvent(state, EVENT_TYPES.SETTLEMENT_PLACED, {
      playerId,
      vertexId,
      isInitial: true,
      round: state.phase === GAME_PHASES.SETUP_ROUND_2 ? 2 : 1,
      victoryPoints: calculatePublicVictoryPoints(state, playerId),
    }),
  ];

  return events;
}

function applyPlaceInitialRoad(state, playerId, edgeId) {
  const player = state.players[playerId];
  const edge = state.board.edges[edgeId];
  edge.road = { playerId };
  player.roads.push(edgeId);
  state.setup.lastSettlementVertexId = null;
  state.setup.index += 1;
  state.setup.step = SETUP_STEPS.SETTLEMENT;

  const events = [
    appendEvent(state, EVENT_TYPES.ROAD_PLACED, {
      playerId,
      edgeId,
      isInitial: true,
    }),
  ];

  if (state.setup.index >= state.setup.order.length) {
    const previousPhase = state.phase;
    state.phase = GAME_PHASES.AWAITING_ROLL;
    state.currentPlayerId = 0;
    state.turnNumber = 1;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: previousPhase,
        to: GAME_PHASES.AWAITING_ROLL,
      }),
      appendEvent(state, EVENT_TYPES.SETUP_COMPLETED, {
        startingPlayerId: state.currentPlayerId,
      }),
      appendEvent(state, EVENT_TYPES.TURN_STARTED, {
        playerId: state.currentPlayerId,
        turnNumber: state.turnNumber,
      }),
    );
    return events;
  }

  if (state.setup.index === state.players.length) {
    state.phase = GAME_PHASES.SETUP_ROUND_2;
    events.push(
      appendEvent(state, EVENT_TYPES.PHASE_CHANGED, {
        from: GAME_PHASES.SETUP_ROUND_1,
        to: GAME_PHASES.SETUP_ROUND_2,
      }),
    );
  }

  state.currentPlayerId = state.setup.order[state.setup.index];
  events.push(
    appendEvent(state, EVENT_TYPES.TURN_STARTED, {
      playerId: state.currentPlayerId,
      setupIndex: state.setup.index,
    }),
  );
  return events;
}

function valid() {
  return { ok: true };
}

function invalid(code, message, details = null) {
  return { ok: false, code, message, details };
}

function rejected(state, envelope, code, message, details = null) {
  return {
    state,
    result: {
      commandId: envelope.commandId,
      accepted: false,
      version: state.version,
      events: [],
      error: { code, message, details },
    },
  };
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
