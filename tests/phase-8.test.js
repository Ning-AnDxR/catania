import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SERVER_MESSAGES,
} from "../src/network/protocol.js";
import { GAME_PHASES } from "../src/core/constants.js";
import { RoomManager } from "../src/network/room-manager.js";
import {
  MemoryRoomRepository,
  SqliteRoomRepository,
} from "../src/network/room-repository.js";

class FakeSocket {
  constructor() {
    this.messages = [];
  }

  send(message) {
    this.messages.push(structuredClone(message));
  }

  latest(type) {
    return [...this.messages].reverse().find((message) => message.type === type);
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function connect(manager, socket, clientId) {
  manager.connect(clientId, (message) => socket.send(message));
}

function createPlayingRoom(
  repository = new MemoryRoomRepository(),
  turnTimerMs = 60_000,
) {
  const manager = new RoomManager({
    botDelayMs: 60_000,
    reconnectGraceMs: 25,
    roomCleanupMs: 60_000,
    turnTimerMs,
    repository,
  });
  const first = new FakeSocket();
  const second = new FakeSocket();
  connect(manager, first, "client-a");
  connect(manager, second, "client-b");
  manager.joinRoom("client-a", { roomId: "stability-room", name: "A" });
  manager.joinRoom("client-b", { roomId: "stability-room", name: "B" });
  manager.addBot("client-a");
  manager.setReady("client-a", true);
  manager.setReady("client-b", true);
  manager.startGame("client-a");
  return { manager, first, second, room: manager.rooms.get("stability-room") };
}

test("a disconnected human is taken over by a bot after the grace period", async () => {
  const { manager, second, room } = createPlayingRoom();
  manager.disconnect("client-a");

  await wait(45);

  assert.equal(room.seats[0].connected, false);
  assert.equal(room.seats[0].controlledByBot, true);
  assert.ok(second.latest(SERVER_MESSAGES.BOT_TAKEOVER_STARTED));

  manager.destroy();
});

test("reconnecting stops bot takeover and restores the original seat", async () => {
  const { manager, first, second, room } = createPlayingRoom();
  const token = first.latest(SERVER_MESSAGES.ROOM_STATE).self.reconnectToken;
  manager.disconnect("client-a");
  await wait(45);
  assert.equal(room.seats[0].controlledByBot, true);

  const reconnected = new FakeSocket();
  connect(manager, reconnected, "client-c");
  manager.joinRoom("client-c", {
    roomId: "stability-room",
    name: "A",
    reconnectToken: token,
  });

  assert.equal(room.seats[0].controlledByBot, false);
  assert.equal(room.seats[0].connected, true);
  assert.ok(second.latest(SERVER_MESSAGES.BOT_TAKEOVER_ENDED));
  assert.ok(reconnected.latest(SERVER_MESSAGES.STATE_SNAPSHOT));

  manager.destroy();
});

test("host migrates to the next connected human", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const first = new FakeSocket();
  const second = new FakeSocket();
  connect(manager, first, "client-a");
  connect(manager, second, "client-b");
  manager.joinRoom("client-a", { roomId: "host-room", name: "A" });
  manager.joinRoom("client-b", { roomId: "host-room", name: "B" });

  manager.disconnect("client-a");
  const room = manager.rooms.get("host-room");
  assert.equal(room.hostClientId, "client-b");

  manager.destroy();
});

test("a second window sharing localStorage cannot steal a connected seat", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const first = new FakeSocket();
  const second = new FakeSocket();
  const third = new FakeSocket();
  connect(manager, first, "client-a");
  connect(manager, second, "client-b");
  connect(manager, third, "client-c");
  manager.joinRoom("client-a", {
    roomId: "shared-token-room",
    name: "A",
    guestId: "same-browser",
  });
  manager.joinRoom("client-b", {
    roomId: "shared-token-room",
    name: "B",
    guestId: "other-browser",
  });
  const room = manager.rooms.get("shared-token-room");
  const tokenA = room.seats[0].reconnectToken;

  manager.joinRoom("client-c", {
    roomId: "shared-token-room",
    name: "C",
    guestId: "same-browser",
    reconnectToken: tokenA,
  });

  assert.equal(room.seats[0].clientId, "client-a");
  assert.equal(room.seats[0].connected, true);
  assert.equal(room.seats[2].clientId, "client-c");
  assert.notEqual(room.seats[2].reconnectToken, tokenA);

  manager.disconnect("client-a");
  const reconnected = new FakeSocket();
  connect(manager, reconnected, "client-d");
  manager.joinRoom("client-d", {
    roomId: "shared-token-room",
    name: "A",
    reconnectToken: tokenA,
  });
  assert.equal(room.seats[0].clientId, "client-d");
  assert.equal(room.seats[0].connected, true);

  manager.destroy();
});

test("request_sync sends replay events before a fresh snapshot", () => {
  const { manager, first, second, room } = createPlayingRoom();
  const command = room.session.getView(0).validCommands[0];
  manager.submitCommand("client-a", {
    commandId: "setup-replay",
    command,
  });

  manager.requestSync("client-b", { sinceVersion: 0 });

  const replay = second.latest(SERVER_MESSAGES.EVENTS_REPLAYED);
  const snapshot = second.latest(SERVER_MESSAGES.STATE_SNAPSHOT);
  assert.ok(replay);
  assert.ok(snapshot);
  assert.equal(replay.toVersion, room.session.version);

  manager.destroy();
});

test("rejects invalid room ids", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const socket = new FakeSocket();
  connect(manager, socket, "client-a");

  assert.throws(
    () => manager.joinRoom("client-a", { roomId: "../bad room", name: "A" }),
    /invalid characters/,
  );

  manager.destroy();
});

test("a restarted room manager restores the saved game and reconnects the seat", () => {
  const repository = new MemoryRoomRepository();
  const firstRun = createPlayingRoom(repository);
  const reconnectToken = firstRun.first.latest(
    SERVER_MESSAGES.ROOM_STATE,
  ).self.reconnectToken;
  const command = firstRun.room.session.getView(0).validCommands[0];
  firstRun.manager.submitCommand("client-a", {
    commandId: "persisted-command",
    command,
  });
  const versionBeforeRestart = firstRun.room.session.version;
  assert.ok(repository.listGameEvents("stability-room").length > 0);
  assert.throws(
    () => firstRun.manager.requestReplay("client-a"),
    /after the game ends/,
  );
  firstRun.room.session.state.phase = GAME_PHASES.GAME_OVER;
  const replayData = firstRun.manager.requestReplay("client-a");
  assert.equal(replayData.roomId, "stability-room");
  assert.ok(replayData.events.length > 0);

  firstRun.manager.destroy();

  const manager = new RoomManager({
    botDelayMs: 60_000,
    repository,
  });
  manager.loadPersistedRooms();
  const restoredRoom = manager.rooms.get("stability-room");
  assert.ok(restoredRoom);
  assert.equal(restoredRoom.status, "PLAYING");
  assert.equal(restoredRoom.session.version, versionBeforeRestart);

  const reconnected = new FakeSocket();
  connect(manager, reconnected, "client-restored");
  manager.joinRoom("client-restored", {
    roomId: "stability-room",
    name: "A",
    reconnectToken,
  });

  const snapshot = reconnected.latest(SERVER_MESSAGES.STATE_SNAPSHOT);
  assert.ok(snapshot);
  assert.equal(snapshot.view.version, versionBeforeRestart);

  const replay = manager.submitCommand("client-restored", {
    commandId: "persisted-command",
    command,
  });
  assert.equal(replay.accepted, true);
  assert.equal(restoredRoom.session.version, versionBeforeRestart);

  manager.destroy();
});

test("SQLite persistence survives closing and reopening the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "catania-persistence-"));
  const filename = join(directory, "rooms.sqlite");
  try {
    const firstRepository = new SqliteRoomRepository({ filename });
    const firstRun = createPlayingRoom(firstRepository);
    const reconnectToken = firstRun.first.latest(
      SERVER_MESSAGES.ROOM_STATE,
    ).self.reconnectToken;
    const command = firstRun.room.session.getView(0).validCommands[0];
    firstRun.manager.submitCommand("client-a", {
      commandId: "sqlite-event-command",
      command,
    });
    const versionBeforeRestart = firstRun.room.session.version;
    firstRun.manager.destroy();

    const secondRepository = new SqliteRoomRepository({ filename });
    const manager = new RoomManager({
      botDelayMs: 60_000,
      repository: secondRepository,
    });
    manager.loadPersistedRooms();
    const restoredRoom = manager.rooms.get("stability-room");
    assert.ok(restoredRoom);
    assert.equal(restoredRoom.session.version, versionBeforeRestart);
    assert.ok(secondRepository.listGameEvents("stability-room").length > 0);

    const reconnected = new FakeSocket();
    connect(manager, reconnected, "client-sqlite-restored");
    manager.joinRoom("client-sqlite-restored", {
      roomId: "stability-room",
      name: "A",
      reconnectToken,
    });
    assert.ok(reconnected.latest(SERVER_MESSAGES.STATE_SNAPSHOT));

    manager.destroy();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the server turn timer automatically performs a legal human action", async () => {
  const { manager, first, room } = createPlayingRoom(
    new MemoryRoomRepository(),
    25,
  );
  const versionBeforeTimeout = room.session.version;
  assert.equal(
    first.latest(SERVER_MESSAGES.STATE_SNAPSHOT).view.timer.actorPlayerId,
    0,
  );

  await wait(80);

  assert.ok(room.session.version > versionBeforeTimeout);
  assert.ok(
    room.session.state.players[0].settlements.length > 0 ||
      room.session.state.players[0].roads.length > 0,
  );
  manager.destroy();
});

test("the host can pause and resume a game and commands are blocked while paused", () => {
  const { manager, first, second, room } = createPlayingRoom(
    new MemoryRoomRepository(),
    60_000,
  );

  assert.throws(() => manager.setRoomPaused("client-b", true), /Only the host/);
  manager.setRoomPaused("client-a", true);
  assert.equal(room.paused, true);
  assert.equal(manager.publicTimer(room), null);
  assert.throws(
    () =>
      manager.submitCommand("client-b", {
        commandId: "paused-command",
        command: { type: "END_TURN" },
      }),
    /room is paused/,
  );

  manager.setRoomPaused("client-a", false);
  assert.equal(room.paused, false);
  assert.ok(manager.publicTimer(room));
  manager.destroy();
});

test("the host can update room settings and kick a spectator", () => {
  const { manager, first, room } = createPlayingRoom();
  const spectator = new FakeSocket();
  connect(manager, spectator, "spectator-kick");
  manager.joinSpectator("spectator-kick", {
    roomId: "stability-room",
    name: "待移出",
  });
  const spectatorId = room.spectators.keys().next().value;

  manager.updateRoomSettings("client-a", {
    turnTimerMs: 0,
    allowSpectators: false,
    maxSpectators: 4,
    allowBotTakeover: false,
  });
  assert.equal(room.turnTimerMs, 0);
  assert.equal(room.allowSpectators, false);
  assert.equal(room.maxSpectators, 4);
  assert.equal(room.allowBotTakeover, false);

  manager.kickSpectator("client-a", spectatorId);
  assert.equal(room.spectators.size, 0);
  assert.ok(spectator.latest(SERVER_MESSAGES.SPECTATOR_KICKED));
  manager.destroy();
});

test("spectators receive a public read-only view and do not occupy player seats", () => {
  const { manager, room } = createPlayingRoom();
  const spectator = new FakeSocket();
  connect(manager, spectator, "spectator-client");

  manager.joinSpectator("spectator-client", {
    roomId: "stability-room",
    name: "观众",
  });

  const snapshot = spectator.latest(SERVER_MESSAGES.STATE_SNAPSHOT);
  const roomState = spectator.latest(SERVER_MESSAGES.ROOM_STATE);
  assert.ok(snapshot);
  assert.equal(snapshot.view.viewerType, "SPECTATOR");
  assert.equal(snapshot.view.viewerId, null);
  assert.deepEqual(snapshot.view.validCommands, []);
  assert.equal(snapshot.view.players[0].resources, null);
  assert.equal(snapshot.view.players[0].developmentCards, null);
  assert.ok(snapshot.view.eventLog.every((event) => event.visibility === "PUBLIC"));
  assert.equal(roomState.room.spectatorCount, 1);
  assert.equal(room.seats.filter((seat) => seat.kind !== null).length, 3);

  assert.throws(
    () =>
      manager.submitCommand("spectator-client", {
        commandId: "spectator-command",
        command: { type: "END_TURN" },
      }),
    /Spectators cannot submit game commands/,
  );

  manager.disconnect("spectator-client");
  assert.equal(room.spectators.size, 0);
  manager.destroy();
});

test("spectators cannot join a room that does not exist", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const spectator = new FakeSocket();
  connect(manager, spectator, "missing-spectator");

  assert.throws(
    () =>
      manager.joinSpectator("missing-spectator", {
        roomId: "missing-room",
        name: "观众",
      }),
    /Room does not exist/,
  );
  manager.destroy();
});
