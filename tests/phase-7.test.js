import test from "node:test";
import assert from "node:assert/strict";

import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
} from "../src/network/protocol.js";
import { RoomManager } from "../src/network/room-manager.js";

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

function connect(manager, socket, clientId) {
  manager.connect(clientId, (message) => socket.send(message));
}

test("two humans plus two bots can fill and start a four-player room", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const first = new FakeSocket();
  const second = new FakeSocket();

  connect(manager, first, "client-a");
  connect(manager, second, "client-b");
  manager.handleMessage("client-a", {
    type: CLIENT_MESSAGES.JOIN_ROOM,
    roomId: "room-1",
    name: "真人 A",
  });
  manager.handleMessage("client-b", {
    type: CLIENT_MESSAGES.JOIN_ROOM,
    roomId: "room-1",
    name: "真人 B",
  });
  manager.addBot("client-a");
  manager.addBot("client-a");
  manager.setReady("client-a", true);
  manager.setReady("client-b", true);
  manager.startGame("client-a");

  const room = manager.rooms.get("room-1");
  assert.equal(room.status, "PLAYING");
  assert.equal(room.session.state.players.length, 4);
  assert.deepEqual(
    room.session.state.players.map((player) => player.isBot),
    [false, false, true, true],
  );
  assert.ok(first.latest(SERVER_MESSAGES.STATE_SNAPSHOT));
  assert.ok(second.latest(SERVER_MESSAGES.STATE_SNAPSHOT));

  manager.destroy();
});

test("server injects the authenticated player id and keeps commands idempotent", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const first = new FakeSocket();
  const second = new FakeSocket();
  connect(manager, first, "client-a");
  connect(manager, second, "client-b");
  manager.joinRoom("client-a", { roomId: "room-2", name: "A" });
  manager.joinRoom("client-b", { roomId: "room-2", name: "B" });
  manager.addBot("client-a");
  manager.addBot("client-a");
  manager.setReady("client-a", true);
  manager.setReady("client-b", true);
  manager.startGame("client-a");

  const room = manager.rooms.get("room-2");
  const versionBefore = room.session.version;
  const setupCommand = room.session.getView(0).validCommands[0];
  const firstResult = manager.submitCommand("client-a", {
    commandId: "setup-once",
    command: setupCommand,
  });
  const duplicateResult = manager.submitCommand("client-a", {
    commandId: "setup-once",
    command: setupCommand,
  });

  assert.equal(firstResult.accepted, true, JSON.stringify(firstResult.error));
  assert.equal(duplicateResult.accepted, true);
  assert.equal(room.session.version, versionBefore + 1);
  assert.ok(first.latest(SERVER_MESSAGES.COMMAND_ACCEPTED));

  const unauthorized = manager.submitCommand("client-b", {
    commandId: "end-b",
    command: setupCommand,
  });
  assert.equal(unauthorized.accepted, false);
  assert.equal(unauthorized.error.code, "NOT_YOUR_TURN");

  manager.destroy();
});

test("reconnect token restores the same seat without exposing it in public room state", () => {
  const manager = new RoomManager({ botDelayMs: 60_000 });
  const first = new FakeSocket();
  connect(manager, first, "client-a");
  manager.joinRoom("client-a", { roomId: "room-3", name: "A" });

  const roomState = first.latest(SERVER_MESSAGES.ROOM_STATE);
  const token = roomState.self.reconnectToken;
  assert.ok(token);
  assert.equal(
    roomState.room.seats.some((seat) => "reconnectToken" in seat),
    false,
  );

  manager.disconnect("client-a");
  const reconnected = new FakeSocket();
  connect(manager, reconnected, "client-c");
  manager.joinRoom("client-c", {
    roomId: "room-3",
    name: "A",
    reconnectToken: token,
  });
  const room = manager.rooms.get("room-3");
  assert.equal(room.seats[0].clientId, "client-c");
  assert.equal(room.seats[0].connected, true);

  manager.destroy();
});
