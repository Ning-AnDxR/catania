import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  decodeMessage,
  encodeMessage,
} from "./protocol.js";

export class RemoteGameSession {
  constructor({
    url,
    socket = null,
    roomId = "default",
    name = "玩家",
    reconnectToken = null,
    guestId = null,
    role = "player",
  }) {
    this.isRemote = true;
    this.url = url;
    this.roomId = roomId;
    this.name = name;
    this.reconnectToken = reconnectToken;
    this.guestId = guestId;
    this.role = role;
    this.socket = socket || new WebSocket(url);
    this.clientId = null;
    this.playerId = null;
    this.room = null;
    this.self = null;
    this.view = null;
    this.state = null;
    this.replayedEvents = [];
    this.listeners = new Set();
    this.closed = false;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.socket = null;

    // 注入 socket 是为了测试；正常路径自己建连
    if (socket) this.attach(socket);
    else this.open();
  }

  /** 建一条新连接并挂上监听。重连时也走这里。 */
  open() {
    this.attach(new WebSocket(this.url));
  }

  attach(socket) {
    this.socket = socket;
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      this.send(CLIENT_MESSAGES.JOIN_ROOM, {
        roomId: this.roomId,
        name: this.name,
        reconnectToken: this.reconnectToken,
        guestId: this.guestId,
        role: this.role,
      });
      this.emit({ type: "connected" });
    });
    this.socket.addEventListener("message", (event) => {
      this.handleMessage(decodeMessage(event.data));
    });
    this.socket.addEventListener("close", () => {
      // 主动 close() 不算掉线，不重连
      if (this.closed) {
        this.emit({ type: "disconnected", intentional: true });
        return;
      }
      this.emit({ type: "disconnected" });
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => {
      this.emit({ type: "connection_error" });
    });
  }

  /** 退避重连：1s / 2s / 4s / 8s，最长 15s，连上后计数归零。 */
  scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 15000);
    this.reconnectAttempt += 1;
    this.emit({ type: "reconnecting", attempt: this.reconnectAttempt, delay });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closed) this.open();
    }, delay);
  }

  get version() {
    return this.view?.version ?? 0;
  }

  get phase() {
    return this.view?.phase ?? null;
  }

  dispatch(actorId, command, commandId) {
    const id = commandId || createId("command");
    this.send(CLIENT_MESSAGES.SUBMIT_COMMAND, {
      commandId: id,
      expectedVersion: this.version,
      command,
    });
    return {
      commandId: id,
      accepted: true,
      pending: true,
      version: this.version,
      events: [],
      error: null,
    };
  }

  getView() {
    return this.view;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setReady(ready) {
    this.send(CLIENT_MESSAGES.SET_READY, { ready });
  }

  addBot(difficulty = "medium") {
    this.send(CLIENT_MESSAGES.ADD_BOT, { difficulty });
  }

  removeBot(seatId) {
    this.send(CLIENT_MESSAGES.REMOVE_BOT, { seatId });
  }

  updateRoomSettings(settings) {
    this.send(CLIENT_MESSAGES.UPDATE_ROOM_SETTINGS, { settings });
  }

  setRoomPaused(paused) {
    this.send(CLIENT_MESSAGES.SET_ROOM_PAUSED, { paused });
  }

  kickPlayer(seatId) {
    this.send(CLIENT_MESSAGES.KICK_PLAYER, { seatId });
  }

  kickSpectator(spectatorId) {
    this.send(CLIENT_MESSAGES.KICK_SPECTATOR, { spectatorId });
  }

  transferHost(seatId) {
    this.send(CLIENT_MESSAGES.TRANSFER_HOST, { seatId });
  }

  startGame() {
    this.send(CLIENT_MESSAGES.START_GAME);
  }

  requestSync() {
    this.send(CLIENT_MESSAGES.REQUEST_SYNC, { sinceVersion: this.version });
  }

  requestReplay({ roomId = null, gameId = null } = {}) {
    this.send(CLIENT_MESSAGES.REQUEST_REPLAY, { roomId, gameId });
  }

  requestMatchHistory() {
    this.send(CLIENT_MESSAGES.REQUEST_MATCH_HISTORY);
  }

  leaveRoom() {
    this.send(CLIENT_MESSAGES.LEAVE_ROOM);
  }

  close() {
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.socket?.close();
  }

  send(type, payload = {}) {
    if (this.socket.readyState !== 1) return;
    this.socket.send(encodeMessage(type, payload));
  }

  handleMessage(message) {
    switch (message.type) {
      case SERVER_MESSAGES.CONNECTED:
        this.clientId = message.clientId;
        this.emit({ type: "connected", clientId: this.clientId });
        break;
      case SERVER_MESSAGES.ROOM_STATE:
        this.room = message.room;
        this.self = message.self || this.self;
        if (this.self?.reconnectToken) {
          this.reconnectToken = this.self.reconnectToken;
        }
        this.emit({ type: "room_state", room: this.room, self: this.self });
        break;
      case SERVER_MESSAGES.STATE_SNAPSHOT:
        this.playerId = message.playerId;
        this.room = message.room || this.room;
        this.view = message.view;
        this.state = message.view;
        this.emit({
          type: "snapshot",
          playerId: this.playerId,
          accepted: true,
          version: this.view.version,
          events: [],
          error: null,
        });
        break;
      case SERVER_MESSAGES.EVENTS_REPLAYED:
        this.replayedEvents = message.events || [];
        this.emit({ type: "events_replayed", events: this.replayedEvents });
        break;
      case SERVER_MESSAGES.COMMAND_ACCEPTED:
        this.emit({
          type: "command_accepted",
          commandId: message.commandId,
          accepted: true,
          version: message.version,
          events: [],
          error: null,
        });
        break;
      case SERVER_MESSAGES.COMMAND_REJECTED:
        this.emit({
          type: "command_rejected",
          commandId: message.commandId,
          accepted: false,
          version: message.version,
          events: [],
          error: message.error,
        });
        break;
      default:
        this.emit(message);
    }
  }

  emit(message) {
    for (const listener of this.listeners) listener(message);
  }
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
