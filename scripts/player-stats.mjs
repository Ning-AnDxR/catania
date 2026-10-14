import { resolve } from "node:path";
import { SqliteRoomRepository } from "../src/network/room-repository.js";

const requestedName = process.argv[2] || null;
const repository = new SqliteRoomRepository({
  filename:
    process.env.CATANIA_DB_PATH ||
    resolve(process.cwd(), "data", "catania.sqlite"),
});

try {
  const matches = repository.listMatchResults();
  const stats = new Map();

  for (const match of matches) {
    for (const player of match.players || []) {
      if (requestedName && player.name !== requestedName) continue;
      const current = stats.get(player.name) || {
        name: player.name,
        games: 0,
        wins: 0,
        points: 0,
        settlements: 0,
        cities: 0,
        roads: 0,
      };
      current.games += 1;
      if (player.id === match.winnerId) current.wins += 1;
      current.settlements += player.settlements?.length || 0;
      current.cities += player.cities?.length || 0;
      current.roads += player.roads?.length || 0;
      stats.set(player.name, current);
    }
  }

  if (stats.size === 0) {
    console.log("No match history found.");
  } else {
    for (const player of [...stats.values()].sort(
      (first, second) => second.wins - first.wins || first.name.localeCompare(second.name),
    )) {
      console.log(
        `${player.name}: ${player.games} 局, ${player.wins} 胜, ` +
          `定居点 ${player.settlements}, 城市 ${player.cities}, 道路 ${player.roads}`,
      );
    }
  }
} finally {
  repository.close();
}
