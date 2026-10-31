import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");

describe("health", () => {
  it("reports ok and applied migrations", async () => {
    const db = openDb(":memory:", migrations);
    const app = buildApp({ port: 0, host: "127.0.0.1", dataDir: "", webDir: "/nonexistent" }, db);
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations: 2 });
  });
});
