import { randomUUID } from "node:crypto";

import {
  AI_DIFFICULTIES,
  chooseBotCommand,
} from "../bots/heuristic-bot.js";
import { COMMAND_TYPES, GAME_PHASES } from "../core/constants.js";
import { projectSpectatorView } from "../core/projection.js";
import { LocalGameSession } from "../core/session.js";
import { CLIENT_MESSAGES, SERVER_MESSAGES } from "./protocol.js";
import { MemoryRoomRepository } from "./room-repository.js";

export class RoomManager {
  constructor({
    botDelayMs = 450,
    reconnectGraceMs = 30_000,
    roomCleanupMs = 24 * 60 * 60 * 1000,
    lobbyCleanupMs = 300_000,
    turnTimerMs = 60_000,
    allowBotTakeover = true,
    rateLimitPerSecond = 30,
    random = Math.random,
    sessionFactory = (options) => new LocalGameSession(options),
    repository = new MemoryRoomRepository(),
  } = {}) {
    this.botDelayMs = botDelayMs;
    this.reconnectGraceMs = reconnectGraceMs;
    this.roomCleanupMs = roomCleanupMs;
    this.lobbyCleanupMs = lobbyCleanupMs;
    this.turnTimerMs = turnTimerMs;
    this.allowBotTakeover = allowBotTakeover;
    this.rateLimitPerSecond = rateLimitPerSecond;
    this.random = random;
    this.sessionFactory = sessionFactory;
    this.repository = repository;
    this.clients = new Map();
    this.rooms = new Map();
  }

  loadPersistedRooms() {
    for (const roomId of this.repository.listRoomIds()) {
      this.restoreRoom(roomId);
    }
  }

  restoreRoom(roomId) {
    if (this.rooms.has(roomId)) return this.rooms.get(roomId);
    const snapshot = this.repository.loadRoom(roomId);
    if (!snapshot) return null;

    const room = this.createRoom(snapshot.id || roomId);
    room.status = snapshot.status || "LOBBY";
    room.hostClientId = null;
    room.createdAt = Number(snapshot.createdAt || Date.now());
    room.updatedAt = Number(snapshot.updatedAt || room.createdAt);
    room.matchSaved = Boolean(snapshot.matchSaved);
    room.allowSpectators = snapshot.allowSpectators !== false;
    room.maxSpectators = Number(snapshot.maxSpectators || 10);
    room.allowBotTakeover = snapshot.allowBotTakeover !== false;
    room.turnTimerMs = Number(snapshot.turnTimerMs || this.turnTimerMs);
    room.turnDeadline = Number(snapshot.turnDeadline || 0) || null;
    room.turnActorPlayerId = snapshot.turnActorPlayerId ?? null;
    room.turnTimer = null;
    room.turnTimerToken = null;
    room.paused = Boolean(snapshot.paused);
    room.pausedByPlayerId = snapshot.pausedByPlayerId ?? null;
    room.pauseRemainingMs = Number(snapshot.pauseRemainingMs || 0) || null;
    room.spectators = new Map();
    room.seats = room.seats.map((defaultSeat, seatId) => {
      const persistedSeat = snapshot.seats?.[seatId] || {};
      const seat = {
        ...defaultSeat,
        ...persistedSeat,
        seatId,
        clientId: null,
        connected: persistedSeat.kind === "BOT",
        controlledByBot: Boolean(persistedSeat.controlledByBot),
        disconnectedAt:
          persistedSeat.kind === "HUMAN" ? Date.now() : null,
        takeoverTimer: null,
        guestId: persistedSeat.guestId || null,
      };
      if (room.status === "LOBBY" && seat.kind === "HUMAN") {
        seat.ready = false;
      }
      return seat;
    });
    room.session = snapshot.sessionState
      ? this.sessionFactory({ state: snapshot.sessionState })
      : null;
    this.rooms.set(room.id, room);
    this.scheduleRoomCleanup(room);
    if (room.status === "PLAYING" && !room.paused) {
      this.scheduleTurnTimer(room, { preserveDeadline: true });
    }
    return room;
  }

  persistRoom(room) {
    room.updatedAt = Date.now();
    this.repository.saveRoom(serializeRoom(room));
  }

  recordCommandResult(room, result) {
    room.processedCommands.set(result.commandId, structuredClone(result));
    if (result.accepted) {
      room.updatedAt = Date.now();
      this.repository.saveRoomWithCommand(serializeRoom(room), result);
    } else {
      this.repository.saveCommandResult(room.id, result);
    }
    this.recordMatchIfFinished(room);
  }

  recordMatchIfFinished(room) {
    const state = room.session?.state;
    if (!state || state.phase !== GAME_PHASES.GAME_OVER || room.matchSaved) return;
    this.repository.saveMatchResult({
      roomId: room.id,
      gameId: state.gameId,
      winnerId: state.winnerId,
      version: state.version,
      endedAt: Date.now(),
      players: state.players.map((player) => ({
        id: player.id,
        name: player.name,
        isBot: player.isBot,
        resources: player.resources,
        settlements: player.settlements,
        cities: player.cities,
        roads: player.roads,
      })),
    });
    room.matchSaved = true;
    this.persistRoom(room);
  }

  resolveTurnActor(room) {
    if (room.status !== "PLAYING" || !room.session) return null;
    const state = room.session.state;
    if (state.phase === GAME_PHASES.GAME_OVER) return null;

    if (state.trade) {
      return state.trade.currentResponderPlayerId ?? state.trade.fromPlayerId;
    }
    if (state.phase === GAME_PHASES.AWAITING_DISCARD) {
      const playerIds = Object.keys(
        state.pendingAction?.requiredByPlayer || {},
      ).map(Number);
      return playerIds[0] ?? null;
    }
    return state.currentPlayerId;
  }

  publicTimer(room) {
    if (
      room.paused ||
      room.turnTimerMs <= 0 ||
      !room.turnDeadline ||
      room.turnActorPlayerId === null
    ) {
      return null;
    }
    return {
      actorPlayerId: room.turnActorPlayerId,
      deadline: room.turnDeadline,
      durationMs: room.turnTimerMs,
    };
  }

  scheduleTurnTimer(
    room,
    { preserveDeadline = false, remainingMs = null } = {},
  ) {
    this.clearTurnTimer(room);
    if (
      room.status !== "PLAYING" ||
      !room.session ||
      room.paused ||
      room.turnTimerMs <= 0 ||
      room.session.state.phase === GAME_PHASES.GAME_OVER
    ) {
      room.turnActorPlayerId = null;
      room.turnDeadline = null;
      return;
    }

    const actorPlayerId = this.resolveTurnActor(room);
    if (actorPlayerId === null) {
      room.turnActorPlayerId = null;
      room.turnDeadline = null;
      return;
    }
    const seat = room.seats.find(
      (candidate) => candidate.playerId === actorPlayerId,
    );
    if (
      !seat ||
      seat.kind !== "HUMAN" ||
      seat.controlledByBot
    ) {
      room.turnActorPlayerId = null;
      room.turnDeadline = null;
      return;
    }

    const now = Date.now();
    const existingDeadline =
      room.turnActorPlayerId === actorPlayerId
        ? room.turnDeadline
        : null;
    const deadline =
      remainingMs !== null
        ? now + Math.max(0, Number(remainingMs))
        : preserveDeadline && existingDeadline && existingDeadline > now
          ? existingDeadline
          : now + room.turnTimerMs;
    const token = randomUUID();
    room.turnActorPlayerId = actorPlayerId;
    room.turnDeadline = deadline;
    room.turnTimerToken = token;
    room.turnTimer = setTimeout(
      () => this.handleTurnTimeout(room, actorPlayerId, token),
      Math.max(0, deadline - now),
    );
    room.turnTimer.unref?.();
    this.persistRoom(room);
  }

  clearTurnTimer(room) {
    if (room.turnTimer) clearTimeout(room.turnTimer);
    room.turnTimer = null;
    room.turnTimerToken = null;
  }

  handleTurnTimeout(room, expectedActorId, token) {
    if (room.turnTimerToken !== token) return;
    this.clearTurnTimer(room);
    room.turnDeadline = null;
    const actorPlayerId = this.resolveTurnActor(room);
    if (actorPlayerId === null || actorPlayerId !== expectedActorId) {
      this.scheduleTurnTimer(room);
      return;
    }

    const command = this.chooseTimeoutCommand(room, actorPlayerId);
    if (!command) {
      this.scheduleTurnTimer(room);
      return;
    }
    const result = room.session.dispatch(
      actorPlayerId,
      command,
      `timeout-${randomUUID()}`,
    );
    this.recordCommandResult(room, result);
    if (result.accepted) {
      this.scheduleBot(room);
      this.scheduleTurnTimer(room);
      this.broadcastState(room);
    } else {
      this.scheduleTurnTimer(room);
    }
  }

  chooseTimeoutCommand(room, playerId) {
    const state = room.session.state;
    if (state.trade) {
      if (state.trade.currentResponderPlayerId === playerId) {
        return { type: COMMAND_TYPES.RESPOND_TO_TRADE, accepted: false };
      }
      return { type: COMMAND_TYPES.CANCEL_TRADE };
    }
    if (state.phase === GAME_PHASES.AWAITING_ROLL) {
      return { type: COMMAND_TYPES.ROLL_DICE };
    }
    if (state.phase === GAME_PHASES.TURN_ACTIONS) {
      return { type: COMMAND_TYPES.END_TURN };
    }
    return chooseBotCommand(
      room.session.getView(playerId),
      "medium",
      () => 0,
    );
  }

  connect(clientId, send) {
    this.clients.set(clientId, {
      id: clientId,
      send,
      roomId: null,
      seatId: null,
      spectatorId: null,
      role: null,
      rateWindowStart: Date.now(),
      rateCount: 0,
    });
    this.send(clientId, SERVER_MESSAGES.CONNECTED, { clientId });
  }

  disconnect(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return;

    const room = this.rooms.get(client.roomId);
    if (room) {
      if (client.spectatorId) {
        this.removeSpectator(room, client.spectatorId, clientId);
        this.clients.delete(clientId);
        return;
      }
      const seat = room.seats[client.seatId];
      if (room.status === "LOBBY") {
        this.clearSeat(room, seat);
      } else if (seat?.kind === "HUMAN") {
        seat.connected = false;
        seat.disconnectedAt = Date.now();
        this.scheduleTakeover(room, seat);
      }
      this.reassignHost(room);
      this.broadcastRoom(room);
      this.broadcast(room, SERVER_MESSAGES.PLAYER_DISCONNECTED, {
        seatId: client.seatId,
        playerId: seat?.playerId ?? null,
      });
      this.scheduleRoomCleanup(room);
      this.scheduleTurnTimer(room, { preserveDeadline: true });
      this.persistRoom(room);
    }

    this.clients.delete(clientId);
  }

  handleMessage(clientId, message) {
    try {
      if (!this.allowMessage(clientId)) {
        return this.sendError(clientId, "RATE_LIMIT", "Too many messages.");
      }
      switch (message.type) {
        case CLIENT_MESSAGES.JOIN_ROOM:
          return message.role === "spectator"
            ? this.joinSpectator(clientId, message)
            : this.joinRoom(clientId, message);
        case CLIENT_MESSAGES.LEAVE_ROOM:
          return this.leaveRoom(clientId);
        case CLIENT_MESSAGES.SET_READY:
          return this.setReady(clientId, Boolean(message.ready));
        case CLIENT_MESSAGES.ADD_BOT:
          return this.addBot(clientId, message.difficulty);
        case CLIENT_MESSAGES.REMOVE_BOT:
          return this.removeBot(clientId, Number(message.seatId));
        case CLIENT_MESSAGES.UPDATE_ROOM_SETTINGS:
          return this.updateRoomSettings(clientId, message.settings);
        case CLIENT_MESSAGES.SET_ROOM_PAUSED:
          return this.setRoomPaused(clientId, Boolean(message.paused));
        case CLIENT_MESSAGES.KICK_PLAYER:
          return this.kickPlayer(clientId, Number(message.seatId));
        case CLIENT_MESSAGES.KICK_SPECTATOR:
          return this.kickSpectator(clientId, message.spectatorId);
        case CLIENT_MESSAGES.TRANSFER_HOST:
          return this.transferHost(clientId, Number(message.seatId));
        case CLIENT_MESSAGES.START_GAME:
          return this.startGame(clientId);
        case CLIENT_MESSAGES.SUBMIT_COMMAND:
          return this.submitCommand(clientId, message);
        case CLIENT_MESSAGES.REQUEST_SYNC:
          return this.requestSync(clientId, message);
        case CLIENT_MESSAGES.REQUEST_REPLAY:
          return this.requestReplay(clientId, message);
        case CLIENT_MESSAGES.REQUEST_MATCH_HISTORY:
          return this.requestMatchHistory(clientId);
        default:
          return this.sendError(clientId, "UNKNOWN_MESSAGE", "Unknown message type.");
      }
    } catch (error) {
      return this.sendError(clientId, error.code || "SERVER_ERROR", error.message);
    }
  }

  allowMessage(clientId) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    const now = Date.now();
    if (now - client.rateWindowStart >= 1000) {
      client.rateWindowStart = now;
      client.rateCount = 0;
    }
    client.rateCount += 1;
    return client.rateCount <= this.rateLimitPerSecond;
  }

  joinRoom(
    clientId,
    {
      roomId = "default",
      name = "玩家",
      reconnectToken = null,
      guestId = null,
    } = {},
  ) {
    const client = this.requireClient(clientId);
    if (client.roomId) return;

    const normalizedRoomId = String(roomId).trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(normalizedRoomId)) {
      throw roomError("INVALID_ROOM_ID", "Room id contains invalid characters.");
    }
    let room = this.rooms.get(normalizedRoomId) || this.restoreRoom(normalizedRoomId);
    if (!room) {
      room = this.createRoom(normalizedRoomId);
      this.rooms.set(normalizedRoomId, room);
    }

    const normalizedGuestId = guestId ? String(guestId).slice(0, 80) : null;
    let seat = reconnectToken
      ? room.seats.find(
          (candidate) =>
            candidate.kind === "HUMAN" &&
            candidate.reconnectToken === reconnectToken &&
            (!candidate.connected || candidate.clientId === clientId),
        )
      : null;
    if (!seat && normalizedGuestId) {
      seat =
        room.seats.find(
          (candidate) =>
            candidate.kind === "HUMAN" &&
            candidate.guestId === normalizedGuestId &&
            !candidate.connected,
        ) || null;
    }

    if (seat) {
      if (seat.takeoverTimer) clearTimeout(seat.takeoverTimer);
      const wasBotControlled = seat.controlledByBot;
      seat.clientId = clientId;
      seat.connected = true;
      seat.name = String(name || seat.name || "玩家").slice(0, 20);
      seat.disconnectedAt = null;
      seat.controlledByBot = false;
      seat.takeoverTimer = null;
      seat.guestId = normalizedGuestId || seat.guestId;
      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }
      this.broadcast(room, SERVER_MESSAGES.PLAYER_RECONNECTED, {
        seatId: seat.seatId,
        playerId: seat.playerId,
      });
      if (wasBotControlled) {
        this.broadcast(room, SERVER_MESSAGES.BOT_TAKEOVER_ENDED, {
          seatId: seat.seatId,
          playerId: seat.playerId,
        });
      }
      if (room.botTimer) {
        clearTimeout(room.botTimer);
        room.botTimer = null;
      }
      this.scheduleBot(room);
      if (room.status === "PLAYING") this.startBotWatchdog(room);
      this.scheduleTurnTimer(room, { preserveDeadline: true });
    } else {
      if (room.status !== "LOBBY") throw roomError("ROOM_IN_PROGRESS", "Game has already started.");
      seat = room.seats.find((candidate) => candidate.kind === null);
      if (!seat) throw roomError("ROOM_FULL", "Room is full.");
      seat.kind = "HUMAN";
      seat.clientId = clientId;
      seat.connected = true;
      seat.name = String(name || `玩家 ${seat.seatId + 1}`).slice(0, 20);
      seat.reconnectToken = randomUUID();
      seat.guestId = normalizedGuestId;
    }

    client.roomId = room.id;
    client.seatId = seat.seatId;
    if (!room.hostClientId) room.hostClientId = clientId;

    this.broadcastRoom(room);
    if (room.status === "PLAYING" && room.session) {
      this.sendSnapshot(clientId, room, seat);
    }
    this.persistRoom(room);
    return seat;
  }

  joinSpectator(clientId, { roomId = "default", name = "观众" } = {}) {
    const client = this.requireClient(clientId);
    if (client.roomId) return;

    const normalizedRoomId = String(roomId).trim();
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(normalizedRoomId)) {
      throw roomError("INVALID_ROOM_ID", "Room id contains invalid characters.");
    }

    const room =
      this.rooms.get(normalizedRoomId) || this.restoreRoom(normalizedRoomId);
    if (!room) throw roomError("ROOM_NOT_FOUND", "Room does not exist.");
    if (!room.allowSpectators) {
      throw roomError("SPECTATING_DISABLED", "Spectating is disabled for this room.");
    }
    if (room.spectators.size >= room.maxSpectators) {
      throw roomError("SPECTATOR_LIMIT_REACHED", "Spectator limit has been reached.");
    }

    const spectator = {
      id: randomUUID(),
      clientId,
      name: String(name || "观众").slice(0, 20),
      joinedAt: Date.now(),
    };
    room.spectators.set(spectator.id, spectator);
    client.roomId = room.id;
    client.role = "SPECTATOR";
    client.spectatorId = spectator.id;

    this.broadcast(room, SERVER_MESSAGES.SPECTATOR_JOINED, {
      spectatorId: spectator.id,
      name: spectator.name,
    });
    this.broadcastSpectator(room, SERVER_MESSAGES.SPECTATOR_JOINED, {
      spectatorId: spectator.id,
      name: spectator.name,
    });
    this.broadcastRoom(room);
    if (room.session) this.sendSpectatorSnapshot(clientId, room, spectator);
    return spectator;
  }

  removeSpectator(room, spectatorId, clientId) {
    const spectator = room.spectators.get(spectatorId);
    if (!spectator) return;
    room.spectators.delete(spectatorId);
    this.broadcast(room, SERVER_MESSAGES.SPECTATOR_LEFT, {
      spectatorId,
      name: spectator.name,
    });
    this.broadcastSpectator(room, SERVER_MESSAGES.SPECTATOR_LEFT, {
      spectatorId,
      name: spectator.name,
    });
    this.broadcastRoom(room);
    if (clientId) {
      const client = this.clients.get(clientId);
      if (client) {
        client.roomId = null;
        client.spectatorId = null;
        client.role = null;
      }
    }
  }

  leaveRoom(clientId) {
    const client = this.requireClient(clientId);
    const room = this.rooms.get(client.roomId);
    if (!room) return;

    if (client.spectatorId) {
      this.removeSpectator(room, client.spectatorId, clientId);
      client.roomId = null;
      client.spectatorId = null;
      client.role = null;
      return;
    }

    const seat = room.seats[client.seatId];
    if (room.status === "LOBBY") {
      this.clearSeat(room, seat);
    } else if (seat) {
      seat.connected = false;
      seat.disconnectedAt = Date.now();
      this.scheduleTakeover(room, seat);
    }
    client.roomId = null;
    client.seatId = null;
    this.reassignHost(room);
    this.broadcastRoom(room);
    this.scheduleRoomCleanup(room);
    this.scheduleTurnTimer(room, { preserveDeadline: true });
    this.persistRoom(room);
  }

  setReady(clientId, ready) {
    const { room, seat } = this.requireHumanSeat(clientId);
    if (room.status !== "LOBBY") throw roomError("INVALID_PHASE", "Game has already started.");
    seat.ready = ready;
    this.broadcastRoom(room);
    this.persistRoom(room);
  }

  addBot(clientId, difficulty = "medium") {
    const { room } = this.requireHost(clientId);
    if (room.status !== "LOBBY") throw roomError("INVALID_PHASE", "Game has already started.");
    const seat = room.seats.find((candidate) => candidate.kind === null);
    if (!seat) throw roomError("ROOM_FULL", "Room is full.");

    seat.kind = "BOT";
    seat.name = `Bot ${seat.seatId + 1}`;
    seat.difficulty = AI_DIFFICULTIES.includes(difficulty) ? difficulty : "medium";
    seat.ready = true;
    seat.connected = true;
    this.broadcastRoom(room);
    this.persistRoom(room);
    return seat;
  }

  removeBot(clientId, seatId) {
    const { room } = this.requireHost(clientId);
    if (room.status !== "LOBBY") throw roomError("INVALID_PHASE", "Game has already started.");
    const seat = room.seats[seatId];
    if (!seat || seat.kind !== "BOT") {
      throw roomError("BOT_NOT_FOUND", "Bot seat does not exist.");
    }
    this.clearSeat(room, seat);
    this.broadcastRoom(room);
    this.persistRoom(room);
  }

  updateRoomSettings(clientId, settings = {}) {
    const { room } = this.requireHost(clientId);
    if (!settings || typeof settings !== "object") {
      throw roomError("INVALID_SETTINGS", "Room settings are required.");
    }

    if (settings.turnTimerMs !== undefined) {
      const turnTimerMs = Number(settings.turnTimerMs);
      if (!Number.isFinite(turnTimerMs) || turnTimerMs < 0) {
        throw roomError("INVALID_SETTINGS", "Turn timer is invalid.");
      }
      room.turnTimerMs = turnTimerMs;
    }
    if (settings.allowSpectators !== undefined) {
      room.allowSpectators = Boolean(settings.allowSpectators);
    }
    if (settings.maxSpectators !== undefined) {
      const maxSpectators = Number(settings.maxSpectators);
      if (
        !Number.isInteger(maxSpectators) ||
        maxSpectators < 0 ||
        maxSpectators > 50
      ) {
        throw roomError("INVALID_SETTINGS", "Spectator limit is invalid.");
      }
      if (maxSpectators < room.spectators.size) {
        throw roomError(
          "INVALID_SETTINGS",
          "Spectator limit cannot be lower than the current spectator count.",
        );
      }
      room.maxSpectators = maxSpectators;
    }
    if (settings.allowBotTakeover !== undefined) {
      room.allowBotTakeover = Boolean(settings.allowBotTakeover);
    }

    if (!room.paused && room.status === "PLAYING") {
      this.scheduleTurnTimer(room);
    }
    if (room.session) this.broadcastState(room);
    else this.broadcastRoom(room);
    this.persistRoom(room);
  }

  setRoomPaused(clientId, paused) {
    const { room, seat } = this.requireHost(clientId);
    if (room.status !== "PLAYING" || !room.session) {
      throw roomError("GAME_NOT_STARTED", "Game has not started.");
    }
    if (room.paused === paused) return;

    if (paused) {
      room.pauseRemainingMs = room.turnDeadline
        ? Math.max(0, room.turnDeadline - Date.now())
        : null;
      this.clearTurnTimer(room);
      room.turnDeadline = null;
      room.paused = true;
      room.pausedByPlayerId = seat.playerId;
      if (room.botTimer) {
        clearTimeout(room.botTimer);
        room.botTimer = null;
      }
      this.broadcast(room, SERVER_MESSAGES.ROOM_PAUSED, {
        playerId: seat.playerId,
      });
    } else {
      room.paused = false;
      room.pausedByPlayerId = null;
      const remainingMs = room.pauseRemainingMs;
      room.pauseRemainingMs = null;
      this.scheduleBot(room);
      this.scheduleTurnTimer(room, { remainingMs });
      this.broadcast(room, SERVER_MESSAGES.ROOM_RESUMED, {
        playerId: seat.playerId,
      });
    }

    this.broadcastState(room);
    this.broadcastRoom(room);
    this.persistRoom(room);
  }

  kickPlayer(clientId, seatId) {
    const { room, seat: hostSeat } = this.requireHost(clientId);
    const seat = room.seats[seatId];
    if (!seat || seat.kind !== "HUMAN" || seat.seatId === hostSeat.seatId) {
      throw roomError("PLAYER_NOT_FOUND", "Player cannot be kicked.");
    }

    const kickedClientId = seat.clientId;
    if (room.status === "LOBBY") {
      this.clearSeat(room, seat);
    } else {
      seat.kind = "BOT";
      seat.clientId = null;
      seat.connected = true;
      seat.ready = true;
      seat.controlledByBot = false;
      seat.disconnectedAt = null;
      seat.reconnectToken = null;
      seat.guestId = null;
      seat.difficulty = "medium";
      const player = room.session?.state.players[seat.playerId];
      if (player) {
        player.isBot = true;
        player.difficulty = "medium";
      }
    }

    if (kickedClientId) {
      this.send(kickedClientId, SERVER_MESSAGES.PLAYER_KICKED, {
        seatId: seat.seatId,
        playerId: seat.playerId,
      });
      const kickedClient = this.clients.get(kickedClientId);
      if (kickedClient) {
        kickedClient.roomId = null;
        kickedClient.seatId = null;
        kickedClient.role = null;
      }
    }
    this.broadcast(room, SERVER_MESSAGES.PLAYER_KICKED, {
      seatId: seat.seatId,
      playerId: seat.playerId,
    });
    this.broadcastRoom(room);
    if (room.session) this.broadcastState(room);
    this.scheduleBot(room);
    this.scheduleTurnTimer(room);
    this.persistRoom(room);
  }

  kickSpectator(clientId, spectatorId) {
    const { room } = this.requireHost(clientId);
    const spectator = room.spectators.get(spectatorId);
    if (!spectator) {
      throw roomError("SPECTATOR_NOT_FOUND", "Spectator does not exist.");
    }
    this.send(spectator.clientId, SERVER_MESSAGES.SPECTATOR_KICKED, {
      spectatorId,
    });
    this.removeSpectator(room, spectatorId, spectator.clientId);
    this.broadcastRoom(room);
  }

  transferHost(clientId, seatId) {
    const { room, seat: hostSeat } = this.requireHost(clientId);
    const seat = room.seats[seatId];
    if (
      !seat ||
      seat.kind !== "HUMAN" ||
      !seat.connected ||
      seat.seatId === hostSeat.seatId
    ) {
      throw roomError("PLAYER_NOT_FOUND", "Host target is invalid.");
    }
    room.hostClientId = seat.clientId;
    this.broadcastRoom(room);
    this.persistRoom(room);
  }

  startGame(clientId) {
    const { room } = this.requireHost(clientId);
    if (room.status !== "LOBBY") throw roomError("INVALID_PHASE", "Game has already started.");

    const activeSeats = room.seats.filter((seat) => seat.kind !== null);
    if (activeSeats.length < 3 || activeSeats.length > 4) {
      throw roomError("INVALID_PLAYER_COUNT", "Game requires three or four occupied seats.");
    }
    if (
      activeSeats.some(
        (seat) => seat.kind === "HUMAN" && (!seat.connected || !seat.ready),
      )
    ) {
      throw roomError("PLAYERS_NOT_READY", "All human players must be connected and ready.");
    }

    const players = activeSeats.map((seat, playerId) => {
      seat.playerId = playerId;
      return {
        name: seat.name,
        isBot: seat.kind === "BOT",
        difficulty: seat.difficulty || "medium",
      };
    });
    room.session = this.sessionFactory({
      gameId: `online-${room.id}-${Date.now().toString(36)}`,
      seed: `${room.id}-${Date.now()}`,
      players,
    });
    room.session.start(0);
    room.status = "PLAYING";
    room.botTimer = null;
    room.processedCommands.clear();

    this.broadcast(room, SERVER_MESSAGES.GAME_STARTED, {
      gameId: room.session.state.gameId,
    });
    this.scheduleTurnTimer(room);
    this.broadcastState(room);
    this.scheduleBot(room);
    this.startBotWatchdog(room);
    this.persistRoom(room);
  }

  submitCommand(clientId, { commandId, command, expectedVersion } = {}) {
    const { room, seat } = this.requireHumanSeat(clientId);
    if (room.status !== "PLAYING" || !room.session) {
      throw roomError("GAME_NOT_STARTED", "Game has not started.");
    }
    if (room.paused) {
      throw roomError("ROOM_PAUSED", "The room is paused.");
    }

    const id = commandId || `command-${randomUUID()}`;
    const previous =
      room.processedCommands.get(id) ||
      this.repository.findCommandResult(room.id, id);
    if (previous) {
      room.processedCommands.set(id, structuredClone(previous));
      this.send(
        clientId,
        previous.accepted
          ? SERVER_MESSAGES.COMMAND_ACCEPTED
          : SERVER_MESSAGES.COMMAND_REJECTED,
        previous.accepted
          ? { commandId: id, version: previous.version }
          : { commandId: id, error: previous.error, version: previous.version },
      );
      return previous;
    }

    if (
      expectedVersion !== undefined &&
      Number(expectedVersion) !== room.session.version
    ) {
      const rejection = {
        commandId: id,
        accepted: false,
        version: room.session.version,
        events: [],
        error: {
          code: "VERSION_CONFLICT",
          message: `Expected version ${room.session.version}, received ${expectedVersion}.`,
        },
      };
      room.processedCommands.set(id, structuredClone(rejection));
      this.repository.saveCommandResult(room.id, rejection);
      this.sendReplay(
        clientId,
        room,
        seat,
        Number(expectedVersion),
      );
      this.sendSnapshot(clientId, room, seat);
      this.send(clientId, SERVER_MESSAGES.COMMAND_REJECTED, rejection);
      return rejection;
    }

    const result = room.session.dispatch(seat.playerId, command, id);
    this.recordCommandResult(room, result);
    if (result.accepted) {
      this.send(clientId, SERVER_MESSAGES.COMMAND_ACCEPTED, {
        commandId: result.commandId,
        version: result.version,
      });
      this.scheduleBot(room);
      this.scheduleTurnTimer(room);
      this.broadcastState(room);
    } else {
      this.send(clientId, SERVER_MESSAGES.COMMAND_REJECTED, {
        commandId: result.commandId,
        error: result.error,
        version: result.version,
      });
    }
    return result;
  }

  requestSync(clientId, { sinceVersion } = {}) {
    const client = this.requireClient(clientId);
    const spectatorRoom = this.rooms.get(client.roomId);
    if (client.spectatorId && spectatorRoom) {
      const spectator = spectatorRoom.spectators.get(client.spectatorId);
      if (!spectator || !spectatorRoom.session) {
        throw roomError("ROOM_NOT_FOUND", "Spectator session is not available.");
      }
      const numericSinceVersion = Number(sinceVersion);
      if (
        Number.isInteger(numericSinceVersion) &&
        numericSinceVersion < spectatorRoom.session.version
      ) {
        this.sendSpectatorReplay(clientId, spectatorRoom, numericSinceVersion);
      }
      this.sendSpectatorSnapshot(clientId, spectatorRoom, spectator);
      return projectSpectatorView(spectatorRoom.session.state);
    }

    const { room, seat } = this.requireHumanSeat(clientId);
    if (room.status !== "PLAYING" || !room.session) {
      throw roomError("GAME_NOT_STARTED", "Game has not started.");
    }
    const numericSinceVersion = Number(sinceVersion);
    if (
      Number.isInteger(numericSinceVersion) &&
      numericSinceVersion < room.session.version
    ) {
      this.sendReplay(clientId, room, seat, numericSinceVersion);
    }
    this.sendSnapshot(clientId, room, seat);
    return room.session.getView(seat.playerId);
  }

  requestReplay(clientId, { roomId = null, gameId = null } = {}) {
    const client = this.requireClient(clientId);
    const targetRoomId = roomId || client.roomId;
    if (!targetRoomId) {
      throw roomError("ROOM_NOT_FOUND", "Room id is required.");
    }
    const room = this.rooms.get(targetRoomId);
    if (
      room?.session &&
      room.session.state.phase !== GAME_PHASES.GAME_OVER
    ) {
      throw roomError(
        "REPLAY_NOT_AVAILABLE",
        "Full replay is available after the game ends.",
      );
    }
    let events = this.repository.listGameEvents(targetRoomId, gameId);
    if (!gameId && events.length > 0) {
      gameId = events.at(-1).gameId;
      events = events.filter((event) => event.gameId === gameId);
    }
    if (events.length === 0) {
      throw roomError("REPLAY_NOT_FOUND", "Replay data does not exist.");
    }
    const replay = {
      roomId: targetRoomId,
      gameId,
      fromSequence: events[0].sequence,
      toSequence: events.at(-1).sequence,
      players:
        this.repository
          .listMatchResults()
          .find((match) => match.gameId === gameId)?.players ||
        room?.session?.state?.players?.map((player) => ({
          id: player.id,
          name: player.name,
        })) ||
        [],
      events,
    };
    this.send(clientId, SERVER_MESSAGES.REPLAY_DATA, { replay });
    return replay;
  }

  requestMatchHistory(clientId) {
    this.requireClient(clientId);
    const matches = this.repository.listMatchResults();
    this.send(clientId, SERVER_MESSAGES.MATCH_HISTORY, { matches });
    return matches;
  }

  scheduleBot(room) {
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.status !== "PLAYING" || !room.session || room.paused) return;

    const actorId = this.resolveBotActor(room);
    if (actorId === null) return;

    room.botTimer = setTimeout(() => {
      room.botTimer = null;
      const view = room.session.getView(actorId);
      const seat = room.seats.find((candidate) => candidate.playerId === actorId);
      const command = chooseBotCommand(
        view,
        seat?.difficulty || "medium",
        this.random,
      );
      if (!command) return;

      const result = room.session.dispatch(actorId, command);
      this.recordCommandResult(room, result);
      if (result.accepted) {
        this.scheduleBot(room);
        this.scheduleTurnTimer(room);
        this.broadcastState(room);
      }
    }, this.botDelayMs);
  }

  startBotWatchdog(room) {
    if (room.botWatchdog) clearInterval(room.botWatchdog);
    room.botWatchdog = setInterval(() => {
      if (
        room.status === "PLAYING" &&
        room.session &&
        !room.paused &&
        !room.botTimer
      ) {
        this.scheduleBot(room);
      }
    }, 1000);
    room.botWatchdog.unref?.();
  }

  scheduleTakeover(room, seat) {
    if (room.status !== "PLAYING" || seat.kind !== "HUMAN") return;
    if (!room.allowBotTakeover) return;
    if (seat.takeoverTimer) clearTimeout(seat.takeoverTimer);
    seat.takeoverTimer = setTimeout(() => {
      if (seat.connected || room.status !== "PLAYING") return;
      seat.controlledByBot = true;
      seat.takeoverTimer = null;
      this.broadcast(room, SERVER_MESSAGES.BOT_TAKEOVER_STARTED, {
        seatId: seat.seatId,
        playerId: seat.playerId,
      });
      this.broadcastRoom(room);
      this.scheduleBot(room);
      this.scheduleTurnTimer(room);
      this.persistRoom(room);
    }, this.reconnectGraceMs);
  }

  scheduleRoomCleanup(room) {
    if (room.cleanupTimer) return;
    const hasConnectedHuman = room.seats.some(
      (seat) => seat.kind === "HUMAN" && seat.connected,
    );
    if (hasConnectedHuman) return;

    const cleanupDelay =
      room.status === "PLAYING" ? this.roomCleanupMs : this.lobbyCleanupMs;
    room.cleanupTimer = setTimeout(() => {
      if (
        room.seats.some((seat) => seat.kind === "HUMAN" && seat.connected)
      ) {
        room.cleanupTimer = null;
        return;
      }
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.botWatchdog) clearInterval(room.botWatchdog);
      for (const seat of room.seats) {
        if (seat.takeoverTimer) clearTimeout(seat.takeoverTimer);
      }
      this.repository.deleteRoom(room.id);
      this.rooms.delete(room.id);
    }, cleanupDelay);
  }

  resolveBotActor(room) {
    const state = room.session.state;
    if (state.phase === GAME_PHASES.AWAITING_DISCARD) {
      return this.firstBot(
        room,
        Object.keys(state.pendingAction?.requiredByPlayer || {}).map(Number),
      );
    }
    if (state.trade) {
      if (state.trade.currentResponderPlayerId !== null) {
        return this.isBotPlayer(room, state.trade.currentResponderPlayerId)
          ? state.trade.currentResponderPlayerId
          : null;
      }
      return this.isBotPlayer(room, state.trade.fromPlayerId)
        ? state.trade.fromPlayerId
        : null;
    }
    return this.isBotPlayer(room, state.currentPlayerId)
      ? state.currentPlayerId
      : null;
  }

  firstBot(room, playerIds) {
    const playerId = playerIds.find((candidate) => this.isBotPlayer(room, candidate));
    return playerId ?? null;
  }

  isBotPlayer(room, playerId) {
    return room.seats.some(
      (seat) =>
        seat.playerId === playerId &&
        (seat.kind === "BOT" || seat.controlledByBot),
    );
  }

  createRoom(id) {
    const now = Date.now();
    return {
      id,
      status: "LOBBY",
      hostClientId: null,
      createdAt: now,
      updatedAt: now,
      matchSaved: false,
      allowSpectators: true,
      maxSpectators: 10,
      allowBotTakeover: this.allowBotTakeover,
      spectators: new Map(),
      turnTimerMs: this.turnTimerMs,
      turnDeadline: null,
      turnActorPlayerId: null,
      turnTimer: null,
      turnTimerToken: null,
      paused: false,
      pausedByPlayerId: null,
      pauseRemainingMs: null,
      session: null,
      botTimer: null,
      botWatchdog: null,
      processedCommands: new Map(),
      seats: Array.from({ length: 4 }, (_, seatId) => ({
        seatId,
        kind: null,
        clientId: null,
        playerId: seatId,
        name: null,
        ready: false,
        connected: false,
        controlledByBot: false,
        difficulty: null,
        disconnectedAt: null,
        takeoverTimer: null,
        reconnectToken: null,
        guestId: null,
      })),
    };
  }

  clearSeat(room, seat) {
    if (!seat) return;
    Object.assign(seat, {
      kind: null,
      clientId: null,
      playerId: seat.seatId,
      name: null,
      ready: false,
      connected: false,
      controlledByBot: false,
      difficulty: null,
      disconnectedAt: null,
      takeoverTimer: null,
      reconnectToken: null,
      guestId: null,
    });
  }

  requireClient(clientId) {
    const client = this.clients.get(clientId);
    if (!client) throw roomError("CLIENT_NOT_FOUND", "Client is not connected.");
    return client;
  }

  requireHumanSeat(clientId) {
    const client = this.requireClient(clientId);
    if (client.spectatorId) {
      throw roomError("SPECTATOR_CANNOT_COMMAND", "Spectators cannot submit game commands.");
    }
    const room = this.rooms.get(client.roomId);
    const seat = room?.seats[client.seatId];
    if (!room || seat?.kind !== "HUMAN") {
      throw roomError("NOT_IN_ROOM", "Client is not in a room seat.");
    }
    return { client, room, seat };
  }

  requireHost(clientId) {
    const result = this.requireHumanSeat(clientId);
    if (result.room.hostClientId !== clientId) {
      throw roomError("NOT_HOST", "Only the host can perform this action.");
    }
    return result;
  }

  reassignHost(room) {
    const hostSeat = room.seats.find((seat) => seat.clientId === room.hostClientId);
    if (hostSeat?.kind === "HUMAN" && hostSeat.connected) return;
    const nextHost = room.seats.find(
      (seat) => seat.kind === "HUMAN" && seat.connected,
    );
    room.hostClientId = nextHost?.clientId || null;
  }

  broadcastRoom(room) {
    for (const seat of room.seats) {
      if (seat.kind !== "HUMAN" || !seat.connected || !seat.clientId) continue;
      this.send(seat.clientId, SERVER_MESSAGES.ROOM_STATE, {
        room: this.publicRoom(room),
        self: {
          seatId: seat.seatId,
          reconnectToken: seat.reconnectToken,
        },
      });
    }
    for (const spectator of room.spectators.values()) {
      this.send(spectator.clientId, SERVER_MESSAGES.ROOM_STATE, {
        room: this.publicRoom(room),
        self: {
          spectatorId: spectator.id,
          name: spectator.name,
        },
      });
    }
  }

  broadcastState(room) {
    this.broadcastRoom(room);
    for (const seat of room.seats) {
      if (seat.kind !== "HUMAN" || !seat.connected || !seat.clientId) continue;
      this.sendSnapshot(seat.clientId, room, seat);
    }
    this.broadcastSpectatorState(room);
  }

  broadcastSpectatorState(room) {
    if (!room.session) return;
    for (const spectator of room.spectators.values()) {
      this.sendSpectatorSnapshot(spectator.clientId, room, spectator);
    }
  }

  sendSnapshot(clientId, room, seat) {
    if (!room.session) return;
    const view = room.session.getView(seat.playerId);
    view.timer = this.publicTimer(room);
    this.send(clientId, SERVER_MESSAGES.STATE_SNAPSHOT, {
      playerId: seat.playerId,
      room: this.publicRoom(room),
      view,
    });
  }

  sendSpectatorSnapshot(clientId, room, spectator) {
    if (!room.session) return;
    const view = projectSpectatorView(room.session.state);
    view.timer = this.publicTimer(room);
    this.send(clientId, SERVER_MESSAGES.STATE_SNAPSHOT, {
      playerId: null,
      spectatorId: spectator.id,
      room: this.publicRoom(room),
      view,
    });
  }

  sendReplay(clientId, room, seat, sinceVersion) {
    if (!room.session) return;
    const events = room.session.state.eventLog
      .filter(
        (event) =>
          event.version > sinceVersion &&
          (event.visibility === "PUBLIC" ||
            (event.visibility === "PLAYER" &&
              event.recipientPlayerId === seat.playerId)),
      )
      .map((event) => structuredClone(event));
    this.send(clientId, SERVER_MESSAGES.EVENTS_REPLAYED, {
      fromVersion: sinceVersion,
      toVersion: room.session.version,
      events,
    });
  }

  sendSpectatorReplay(clientId, room, sinceVersion) {
    if (!room.session) return;
    const events = room.session.state.eventLog
      .filter(
        (event) =>
          event.version > sinceVersion &&
          event.visibility === "PUBLIC",
      )
      .map((event) => structuredClone(event));
    this.send(clientId, SERVER_MESSAGES.EVENTS_REPLAYED, {
      fromVersion: sinceVersion,
      toVersion: room.session.version,
      events,
    });
  }

  publicRoom(room) {
    return {
      id: room.id,
      status: room.status,
      hostClientId: room.hostClientId,
      allowSpectators: room.allowSpectators,
      spectatorCount: room.spectators.size,
      maxSpectators: room.maxSpectators,
      allowBotTakeover: room.allowBotTakeover,
      turnTimerMs: room.turnTimerMs,
      paused: room.paused,
      pausedByPlayerId: room.pausedByPlayerId,
      seats: room.seats.map((seat) => ({
        seatId: seat.seatId,
        kind: seat.kind,
        playerId: seat.kind === null ? null : seat.playerId,
        name: seat.name,
        ready: seat.ready,
        connected: seat.connected,
        controlledByBot: seat.controlledByBot,
        difficulty: seat.difficulty || null,
        disconnectedAt: seat.disconnectedAt,
        reconnectDeadline:
          seat.connected || !seat.disconnectedAt
            ? null
            : seat.disconnectedAt + this.reconnectGraceMs,
      })),
      spectators: [...room.spectators.values()].map((spectator) => ({
        spectatorId: spectator.id,
        name: spectator.name,
      })),
    };
  }

  broadcast(room, type, payload = {}) {
    for (const seat of room.seats) {
      if (seat.kind !== "HUMAN" || !seat.connected || !seat.clientId) continue;
      this.send(seat.clientId, type, payload);
    }
  }

  broadcastSpectator(room, type, payload = {}) {
    for (const spectator of room.spectators.values()) {
      this.send(spectator.clientId, type, payload);
    }
  }

  send(clientId, type, payload = {}) {
    const client = this.clients.get(clientId);
    if (!client) return;
    try {
      client.send({ type, ...payload });
    } catch {
      // A disconnected socket is cleaned up by the WebSocket close handler.
    }
  }

  sendError(clientId, code, message) {
    this.send(clientId, SERVER_MESSAGES.ERROR, { code, message });
  }

  destroy() {
    for (const room of this.rooms.values()) {
      if (room.botTimer) clearTimeout(room.botTimer);
      if (room.botWatchdog) clearInterval(room.botWatchdog);
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      if (room.turnTimer) clearTimeout(room.turnTimer);
      for (const seat of room.seats) {
        if (seat.takeoverTimer) clearTimeout(seat.takeoverTimer);
      }
    }
    this.clients.clear();
    this.rooms.clear();
    this.repository.close?.();
  }
}

function serializeRoom(room) {
  return {
    id: room.id,
    status: room.status,
    hostClientId: room.hostClientId,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    matchSaved: room.matchSaved,
    allowSpectators: room.allowSpectators,
    maxSpectators: room.maxSpectators,
    allowBotTakeover: room.allowBotTakeover,
    turnTimerMs: room.turnTimerMs,
    turnDeadline: room.turnDeadline,
    turnActorPlayerId: room.turnActorPlayerId,
    paused: room.paused,
    pausedByPlayerId: room.pausedByPlayerId,
    pauseRemainingMs: room.pauseRemainingMs,
    seats: room.seats.map((seat) => ({
      seatId: seat.seatId,
      kind: seat.kind,
      playerId: seat.playerId,
      name: seat.name,
      ready: seat.ready,
      controlledByBot: seat.controlledByBot,
      difficulty: seat.difficulty,
      disconnectedAt: seat.disconnectedAt,
      reconnectToken: seat.reconnectToken,
      guestId: seat.guestId,
    })),
    sessionState: room.session ? structuredClone(room.session.state) : null,
  };
}

function roomError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
