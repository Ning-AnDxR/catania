import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const backupPath = process.argv[2];
if (!backupPath) {
  console.error("Usage: node scripts/db-restore.mjs <backup-file> [target-file]");
  process.exit(1);
}

const target = resolve(
  process.argv[3] ||
    process.env.CATANIA_DB_PATH ||
    resolve(process.cwd(), "data", "catania.sqlite"),
);
const source = resolve(backupPath);
if (!existsSync(source)) {
  console.error(`Backup not found: ${source}`);
  process.exit(1);
}
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
console.log(`Database restored: ${target}`);
console.error("Restart the game server after restoring the database.");
