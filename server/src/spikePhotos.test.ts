import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { openDb } from "./db.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const KEY = "test-key";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const auth = { "x-upload-key": KEY };

function setup(key: string | null = KEY) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-spike-"));
  const config = { port: 0, host: "127.0.0.1", dataDir, webDir: "/nonexistent", spikeUploadKey: key ?? undefined };
  return { app: buildApp(config, openDb(":memory:", migrations)), dataDir };
}

type App = ReturnType<typeof setup>["app"];

function upload(app: App, payload: Buffer, headers: Record<string, string> = auth) {
  return app.inject({
    method: "POST",
    url: "/api/spike/photos",
    payload,
    headers: { "content-type": "image/jpeg", ...headers },
  });
}

describe("spike photos", () => {
  it("is disabled without a configured key", async () => {
    const { app } = setup(null);
    expect((await upload(app, JPEG)).statusCode).toBe(503);
  });

  it("rejects a missing or wrong key", async () => {
    const { app } = setup();
    expect((await upload(app, JPEG, {})).statusCode).toBe(401);
    expect((await upload(app, JPEG, { "x-upload-key": "nope" })).statusCode).toBe(401);
    expect((await app.inject("/api/spike/photos")).statusCode).toBe(401);
  });

  it("stores, lists, serves and deletes a JPEG", async () => {
    const { app, dataDir } = setup();
    const res = await upload(app, JPEG);
    expect(res.statusCode).toBe(201);
    const { id, size } = res.json();
    expect(size).toBe(JPEG.length);
    expect(fs.existsSync(path.join(dataDir, "spike-photos", `${id}.jpg`))).toBe(true);

    const list = await app.inject({ url: "/api/spike/photos", headers: auth });
    expect(list.json().map((p: { id: string }) => p.id)).toEqual([id]);

    const img = await app.inject({ url: `/api/spike/photos/${id}`, headers: auth });
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.rawPayload.equals(JPEG)).toBe(true);

    const del = await app.inject({ method: "DELETE", url: `/api/spike/photos/${id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ url: `/api/spike/photos/${id}`, headers: auth })).statusCode).toBe(404);
  });

  it("rejects non-JPEG bodies", async () => {
    const { app } = setup();
    expect((await upload(app, Buffer.from("not an image"))).statusCode).toBe(415);
    const png = await app.inject({
      method: "POST",
      url: "/api/spike/photos",
      payload: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      headers: { ...auth, "content-type": "image/png" },
    });
    expect(png.statusCode).toBe(415);
  });

  it("accepts uploads larger than Fastify's 1 MB default", async () => {
    const { app } = setup();
    const big = Buffer.concat([JPEG.subarray(0, 4), Buffer.alloc(3 * 1024 * 1024)]);
    expect((await upload(app, big)).statusCode).toBe(201);
  });

  it("only serves ids that are bare UUIDs", async () => {
    const { app } = setup();
    for (const id of ["..%2F..%2Fstore.db", "abc", "00000000-0000-0000-0000-000000000000"]) {
      expect((await app.inject({ url: `/api/spike/photos/${id}`, headers: auth })).statusCode).toBe(404);
    }
  });
});
