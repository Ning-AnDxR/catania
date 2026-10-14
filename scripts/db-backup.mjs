import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const source = resolve(
  process.env.CATANIA_DB_PATH || resolve(root, "data", "catania.sqlite"),
);
const requestedTarget = process.argv[2];
const target = resolve(
  requestedTarget ||
    resolve(
      root,
      "data",
      "backups",
      `catania-${new Date().toISOString().replaceAll(":", "-")}.sqlite`,
    ),
);

if (!existsSync(source)) {
  console.error(`Database not found: ${source}`);
  process.exit(1);
}
if (existsSync(target)) {
  console.error(`Backup already exists: ${target}`);
  process.exit(1);
}

mkdirSync(dirname(target), { recursive: true });
const escapedTarget = target.replaceAll("'", "''");
const db = new DatabaseSync(source);
try {
  db.exec(`VACUUM INTO '${escapedTarget}'`);
} finally {
  db.close();
}
console.log(`Backup created: ${target}`);
