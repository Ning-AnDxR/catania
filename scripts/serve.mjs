import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WebSocketServer } from "ws";

import { SqliteRoomRepository } from "../src/network/room-repository.js";
import { RoomManager } from "../src/network/room-manager.js";
import { decodeMessage, encodeMessage } from "../src/network/protocol.js";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const turnTimerMs = Number(process.env.CATANIA_TURN_TIMER_MS || 60_000);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || host}`);
    const requestedPath = decodeURIComponent(url.pathname);
    if (requestedPath === "/") {
      response.writeHead(302, { Location: "/debug/" });
      response.end();
      return;
    }

    const relativePath = requestedPath;
    const filePath = resolve(root, `.${relativePath}`);

    if (!filePath.startsWith(`${root}${sep}`) && filePath !== root) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const fileStat = await stat(filePath);
    const finalPath = fileStat.isDirectory() ? resolve(filePath, "index.html") : filePath;
    const content = await readFile(finalPath);

    response.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Type": mimeTypes[extname(finalPath)] || "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error?.code === "ENOENT" ? 404 : 500, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end(error?.code === "ENOENT" ? "Not found" : "Server error");
  }
});

const repository = new SqliteRoomRepository({
  filename:
    process.env.CATANIA_DB_PATH ||
    resolve(root, "data", "catania.sqlite"),
});
const rooms = new RoomManager({
  repository,
  turnTimerMs:
    Number.isFinite(turnTimerMs) && turnTimerMs > 0
      ? turnTimerMs
      : 60_000,
});
rooms.loadPersistedRooms();
const webSocketServer = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 64 * 1024,
});

webSocketServer.on("connection", (socket) => {
  const clientId = randomUUID();
  rooms.connect(clientId, (message) => {
    if (socket.readyState === 1) {
      socket.send(encodeMessage(message.type, omitType(message)));
    }
  });

  socket.on("message", (raw) => {
    try {
      rooms.handleMessage(clientId, decodeMessage(raw.toString()));
    } catch (error) {
      socket.send(
        encodeMessage("error", {
          code: "INVALID_MESSAGE",
          message: error.message,
        }),
      );
    }
  });

  socket.on("close", () => rooms.disconnect(clientId));
  socket.on("error", () => rooms.disconnect(clientId));
});

server.listen(port, host, () => {
  console.log(`Catania Online running at http://${host}:${port}/`);
  console.log(`WebSocket endpoint: ws://${host}:${port}/ws`);
  console.log("Press Ctrl+C to stop.");
});

function shutdown() {
  webSocketServer.close();
  server.close(() => {
    rooms.destroy();
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function omitType(message) {
  const { type, ...payload } = message;
  return payload;
}
