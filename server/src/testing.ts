// Test helpers (not part of the runtime build: excluded via tsconfig "exclude").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, type AppOptions } from "./app.js";
import { setPassword, SESSION_COOKIE } from "./auth.js";
import { openDb } from "./db.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
export const PASSWORD = "correct horse battery";
export const CSRF = { "x-requested-with": "store-manager" };

export function newApp(opts: AppOptions = {}) {
  const db = openDb(":memory:", migrations);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-test-"));
  const config = {
    port: 0,
    host: "127.0.0.1",
    dataDir,
    webDir: "/nonexistent",
    backupDir: path.join(dataDir, "backups"),
    backupIntervalHours: 24,
    backupKeep: 3,
  };
  const app = buildApp(config, db, opts);
  return { app, db, dataDir };
}

/** An app with the password set and a signed-in client helper. */
export async function signedIn(opts: AppOptions = {}) {
  const { app, db, dataDir } = newApp(opts);
  await setPassword(db, PASSWORD);
  const res = await app.inject({ method: "POST", url: "/api/auth/login", headers: CSRF, payload: { password: PASSWORD } });
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  const headers = { ...CSRF, cookie: `${SESSION_COOKIE}=${cookie.value}` };

  const call = async (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, headers, ...(payload ? { payload } : {}) });

  return { app, db, dataDir, call, headers };
}
