import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** Opens the SQLite database and applies any pending migrations in order. */
export function openDb(file: string, migrationsDir: string): Database.Database {
  if (file !== ":memory:") ensureWritableDir(path.dirname(file));
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db, migrationsDir);
  return db;
}

/** Fails fast with an actionable message instead of SQLite's bare SQLITE_CANTOPEN. */
export function ensureWritableDir(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    const uid = process.getuid?.() ?? "?";
    throw new Error(
      `Data directory ${dir} is not writable by uid ${uid}. ` +
        `On the host, run: sudo chown -R ${uid}:${uid} <your data folder>`,
    );
  }
}

export function migrate(db: Database.Database, dir: string): string[] {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    db.prepare("SELECT name FROM schema_migrations").all().map((r) => (r as { name: string }).name),
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(f);
    })();
    ran.push(f);
  }
  return ran;
}
