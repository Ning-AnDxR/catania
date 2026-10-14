import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class MemoryRoomRepository {
  constructor() {
    this.rooms = new Map();
    this.commandResults = new Map();
    this.matchResults = [];
    this.gameEvents = [];
  }

  loadRoom(roomId) {
    const snapshot = this.rooms.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  listRoomIds() {
    return [...this.rooms.keys()];
  }

  saveRoom(snapshot) {
    this.rooms.set(snapshot.id, structuredClone(snapshot));
  }

  deleteRoom(roomId) {
    this.rooms.delete(roomId);
    for (const key of this.commandResults.keys()) {
      if (key.startsWith(`${roomId}:`)) this.commandResults.delete(key);
    }
  }

  saveCommandResult(roomId, result) {
    this.commandResults.set(
      `${roomId}:${result.commandId}`,
      structuredClone(result),
    );
  }

  saveRoomWithCommand(snapshot, result) {
    this.saveRoom(snapshot);
    this.saveCommandResult(snapshot.id, result);
    if (result.accepted) {
      for (const event of result.events || []) {
        this.saveGameEvent(snapshot.id, event);
      }
    }
  }

  saveGameEvent(roomId, event) {
    this.gameEvents.push({ roomId, ...structuredClone(event) });
  }

  listGameEvents(roomId, gameId = null) {
    return this.gameEvents
      .filter(
        (event) =>
          event.roomId === roomId &&
          (!gameId || event.gameId === gameId),
      )
      .map((event) => structuredClone(event));
  }

  findCommandResult(roomId, commandId) {
    const result = this.commandResults.get(`${roomId}:${commandId}`);
    return result ? structuredClone(result) : null;
  }

  saveMatchResult(result) {
    this.matchResults.push(structuredClone(result));
  }

  listMatchResults() {
    return this.matchResults.map((result) => structuredClone(result));
  }

  close() {}
}

export class SqliteRoomRepository {
  constructor({
    filename = resolve(process.cwd(), "data", "catania.sqlite"),
  } = {}) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        room_json TEXT NOT NULL,
        game_state_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS processed_commands (
        room_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        accepted INTEGER NOT NULL,
        version INTEGER NOT NULL,
        result_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (room_id, command_id),
        FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS match_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        winner_id INTEGER,
        version INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS game_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        recipient_player_id INTEGER,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (room_id, game_id, sequence)
      );
    `);

    this.saveRoomStatement = this.db.prepare(`
      INSERT INTO rooms (
        id,
        status,
        version,
        room_json,
        game_state_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        version = excluded.version,
        room_json = excluded.room_json,
        game_state_json = excluded.game_state_json,
        updated_at = excluded.updated_at
    `);
    this.loadRoomStatement = this.db.prepare(
      "SELECT room_json FROM rooms WHERE id = ?",
    );
    this.listRoomIdsStatement = this.db.prepare(
      "SELECT id FROM rooms ORDER BY updated_at ASC",
    );
    this.deleteRoomStatement = this.db.prepare(
      "DELETE FROM rooms WHERE id = ?",
    );
    this.saveCommandStatement = this.db.prepare(`
      INSERT INTO processed_commands (
        room_id,
        command_id,
        accepted,
        version,
        result_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id, command_id) DO UPDATE SET
        accepted = excluded.accepted,
        version = excluded.version,
        result_json = excluded.result_json,
        created_at = excluded.created_at
    `);
    this.findCommandStatement = this.db.prepare(`
      SELECT result_json
      FROM processed_commands
      WHERE room_id = ? AND command_id = ?
    `);
    this.saveMatchStatement = this.db.prepare(`
      INSERT INTO match_results (
        room_id,
        winner_id,
        version,
        summary_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    this.saveEventStatement = this.db.prepare(`
      INSERT OR IGNORE INTO game_events (
        room_id,
        game_id,
        sequence,
        version,
        event_type,
        visibility,
        recipient_player_id,
        payload_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.listEventsStatement = this.db.prepare(`
      SELECT
        room_id AS roomId,
        game_id AS gameId,
        sequence,
        version,
        event_type AS type,
        visibility,
        recipient_player_id AS recipientPlayerId,
        payload_json AS payloadJson
      FROM game_events
      WHERE room_id = ? AND (? IS NULL OR game_id = ?)
      ORDER BY sequence ASC
    `);
    this.listMatchesStatement = this.db.prepare(`
      SELECT summary_json
      FROM match_results
      ORDER BY created_at DESC
    `);
  }

  loadRoom(roomId) {
    const row = this.loadRoomStatement.get(roomId);
    return row ? JSON.parse(row.room_json) : null;
  }

  listRoomIds() {
    return this.listRoomIdsStatement.all().map((row) => row.id);
  }

  saveRoom(snapshot) {
    const state = snapshot.sessionState;
    this.saveRoomStatement.run(
      snapshot.id,
      snapshot.status,
      Number(state?.version || 0),
      JSON.stringify(snapshot),
      state ? JSON.stringify(state) : null,
      Number(snapshot.createdAt || Date.now()),
      Number(snapshot.updatedAt || Date.now()),
    );
  }

  deleteRoom(roomId) {
    this.deleteRoomStatement.run(roomId);
  }

  saveCommandResult(roomId, result) {
    this.saveCommandStatement.run(
      roomId,
      result.commandId,
      result.accepted ? 1 : 0,
      Number(result.version || 0),
      JSON.stringify(result),
      Date.now(),
    );
  }

  saveRoomWithCommand(snapshot, result) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.saveRoom(snapshot);
      this.saveCommandResult(snapshot.id, result);
      if (result.accepted) {
        for (const event of result.events || []) {
          this.saveGameEvent(snapshot.id, event);
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  saveGameEvent(roomId, event) {
    this.saveEventStatement.run(
      roomId,
      event.gameId,
      Number(event.sequence),
      Number(event.version),
      event.type,
      event.visibility,
      event.recipientPlayerId ?? null,
      JSON.stringify(event.payload || {}),
      Date.now(),
    );
  }

  listGameEvents(roomId, gameId = null) {
    return this.listEventsStatement.all(roomId, gameId, gameId).map((row) => ({
      roomId: row.roomId,
      gameId: row.gameId,
      sequence: Number(row.sequence),
      version: Number(row.version),
      type: row.type,
      visibility: row.visibility,
      recipientPlayerId:
        row.recipientPlayerId === null
          ? null
          : Number(row.recipientPlayerId),
      payload: JSON.parse(row.payloadJson),
    }));
  }

  findCommandResult(roomId, commandId) {
    const row = this.findCommandStatement.get(roomId, commandId);
    return row ? JSON.parse(row.result_json) : null;
  }

  saveMatchResult(result) {
    this.saveMatchStatement.run(
      result.roomId,
      result.winnerId ?? null,
      Number(result.version || 0),
      JSON.stringify(result),
      Date.now(),
    );
  }

  listMatchResults() {
    return this.listMatchesStatement
      .all()
      .map((row) => JSON.parse(row.summary_json));
  }

  close() {
    this.db.close();
  }
}
