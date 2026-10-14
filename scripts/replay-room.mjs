import { resolve } from "node:path";
import { SqliteRoomRepository } from "../src/network/room-repository.js";

const roomId = process.argv[2];
const gameId = process.argv[3] || null;
if (!roomId) {
  console.error("Usage: node scripts/replay-room.mjs <room-id> [game-id]");
  process.exit(1);
}

const repository = new SqliteRoomRepository({
  filename:
    process.env.CATANIA_DB_PATH ||
    resolve(process.cwd(), "data", "catania.sqlite"),
});
try {
  const events = repository.listGameEvents(roomId, gameId);
  if (events.length === 0) {
    console.error("No replay events found.");
    process.exitCode = 1;
  } else {
    console.log(`Room: ${roomId}`);
    console.log(`Game: ${events[0].gameId} · Events: ${events.length}`);
    for (const event of events) {
      console.log(
        `#${String(event.sequence).padStart(4, "0")} v${event.version} ${event.type} ${JSON.stringify(event.payload)}`,
      );
    }
  }
} finally {
  repository.close();
}
