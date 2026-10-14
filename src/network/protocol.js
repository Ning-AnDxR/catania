export const CLIENT_MESSAGES = Object.freeze({
  JOIN_ROOM: "join_room",
  LEAVE_ROOM: "leave_room",
  SET_READY: "set_ready",
  ADD_BOT: "add_bot",
  REMOVE_BOT: "remove_bot",
  UPDATE_ROOM_SETTINGS: "update_room_settings",
  SET_ROOM_PAUSED: "set_room_paused",
  KICK_PLAYER: "kick_player",
  KICK_SPECTATOR: "kick_spectator",
  TRANSFER_HOST: "transfer_host",
  START_GAME: "start_game",
  SUBMIT_COMMAND: "submit_command",
  REQUEST_SYNC: "request_sync",
  REQUEST_REPLAY: "request_replay",
  REQUEST_MATCH_HISTORY: "request_match_history",
});

export const SERVER_MESSAGES = Object.freeze({
  CONNECTED: "connected",
  ROOM_STATE: "room_state",
  GAME_STARTED: "game_started",
  COMMAND_ACCEPTED: "command_accepted",
  COMMAND_REJECTED: "command_rejected",
  GAME_EVENTS: "game_events",
  EVENTS_REPLAYED: "events_replayed",
  STATE_SNAPSHOT: "state_snapshot",
  REPLAY_DATA: "replay_data",
  MATCH_HISTORY: "match_history",
  ERROR: "error",
  PLAYER_DISCONNECTED: "player_disconnected",
  PLAYER_RECONNECTED: "player_reconnected",
  SPECTATOR_JOINED: "spectator_joined",
  SPECTATOR_LEFT: "spectator_left",
  SPECTATOR_KICKED: "spectator_kicked",
  PLAYER_KICKED: "player_kicked",
  ROOM_PAUSED: "room_paused",
  ROOM_RESUMED: "room_resumed",
  BOT_TAKEOVER_STARTED: "bot_takeover_started",
  BOT_TAKEOVER_ENDED: "bot_takeover_ended",
  ROOM_CLOSED: "room_closed",
});

export function encodeMessage(type, payload = {}) {
  return JSON.stringify({ type, ...payload });
}

export function decodeMessage(raw) {
  const message = JSON.parse(String(raw));
  if (!message || typeof message.type !== "string") {
    throw new Error("Message type is required.");
  }
  return message;
}
