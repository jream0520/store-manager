import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const config = loadConfig();
const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const db = openDb(path.join(config.dataDir, "store.db"), migrationsDir);
const app = buildApp(config, db, { startBackups: true });

app.listen({ port: config.port, host: config.host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => app.close().then(() => process.exit(0)));
}
