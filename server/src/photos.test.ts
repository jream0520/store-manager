import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { jpegSize } from "./jpeg.js";
import { MAX_PHOTOS_PER_ITEM, PhotoStore } from "./photos.js";
import { signedIn } from "./testing.js";

/** Minimal structurally valid JPEG: SOI, an APP0 segment, SOF0 with the given size, EOI. */
function fakeJpeg(width: number, height: number, padTo = 0): Buffer {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, 3,
    1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const body = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
  const pad = Buffer.alloc(Math.max(0, padTo - body.length - 2));
  return Buffer.concat([body, pad, Buffer.from([0xff, 0xd9])]);
}

function multipart(files: Record<string, Buffer>) {
  const boundary = "----smtest" + Math.random().toString(16).slice(2);
  const parts = Object.entries(files).map(([name, buf]) =>
    Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}.jpg"\r\n` +
        "Content-Type: image/jpeg\r\n\r\n"),
      buf,
      Buffer.from("\r\n"),
    ]),
  );
  return {
    payload: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function setup() {
  const ctx = await signedIn();
  const item = (await ctx.call("POST", "/api/items", { name: "Scarf" })).json();
  const upload = (files: Record<string, Buffer>, itemId = item.id) => {
    const { payload, contentType } = multipart(files);
    return ctx.app.inject({
      method: "POST",
      url: `/api/items/${itemId}/photos`,
      payload,
      headers: { ...ctx.headers, "content-type": contentType },
    });
  };
  const ok = () => upload({ photo: fakeJpeg(2000, 1500), thumb: fakeJpeg(400, 300) }).then((r) => r.json());
  const reorder = (ids: string[]) =>
    ctx.app.inject({ method: "PUT", url: `/api/items/${item.id}/photos/order`, headers: ctx.headers, payload: { ids } });
  return { ...ctx, item, upload, ok, reorder, photoDir: path.join(ctx.dataDir, "photos") };
}

describe("jpegSize", () => {
  it("reads the frame size and rejects non-JPEGs", () => {
    expect(jpegSize(fakeJpeg(1500, 2000))).toEqual({ width: 1500, height: 2000 });
    expect(jpegSize(Buffer.from("not a jpeg at all"))).toBeUndefined();
    expect(jpegSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeUndefined();
    expect(jpegSize(fakeJpeg(10, 10).subarray(0, 25))).toBeUndefined(); // truncated
  });
});

describe("photos", () => {
  it("uploads, stores both files, lists, and serves them with long caching", async () => {
    const { call, upload, item, photoDir } = await setup();
    const full = fakeJpeg(2000, 1500, 5000);
    const res = await upload({ photo: full, thumb: fakeJpeg(400, 300) });
    expect(res.statusCode).toBe(201);
    const photo = res.json();
    expect(photo).toMatchObject({ itemId: item.id, width: 2000, height: 1500, bytes: full.length, isCover: true });
    expect(fs.readdirSync(photoDir).sort()).toEqual([`${photo.id}.jpg`, `${photo.id}.thumb.jpg`]);

    expect((await call("GET", `/api/items/${item.id}/photos`)).json()).toEqual([photo]);
    const served = await call("GET", `/api/photos/${photo.id}/full`);
    expect(served.headers["content-type"]).toBe("image/jpeg");
    expect(served.headers["cache-control"]).toContain("immutable");
    expect(served.rawPayload.equals(full)).toBe(true);
    expect((await call("GET", `/api/photos/${photo.id}/thumb`)).statusCode).toBe(200);
  });

  it("puts the cover and photo count on the item", async () => {
    const { call, ok, item } = await setup();
    const first = await ok();
    await ok();
    const got = (await call("GET", `/api/items/${item.id}`)).json();
    expect(got).toMatchObject({ coverPhotoId: first.id, photoCount: 2 });
    const listed = (await call("GET", "/api/items")).json().items[0];
    expect(listed).toMatchObject({ coverPhotoId: first.id, photoCount: 2 });
  });

  it("reorders, making the first photo the cover", async () => {
    const { call, ok, reorder, item } = await setup();
    const a = await ok();
    const b = await ok();
    const c = await ok();
    const res = await reorder([c.id, a.id, b.id]);
    expect(res.statusCode).toBe(200);
    expect(res.json().map((p: { id: string; isCover: boolean }) => [p.id, p.isCover])).toEqual([
      [c.id, true],
      [a.id, false],
      [b.id, false],
    ]);
    expect((await call("GET", `/api/items/${item.id}`)).json().coverPhotoId).toBe(c.id);
    expect((await reorder([a.id, b.id])).statusCode).toBe(400); // missing one
    expect((await reorder([a.id, a.id, b.id])).statusCode).toBe(400); // duplicate
  });

  it("deletes a photo and its files; the next one becomes cover", async () => {
    const { call, ok, item, photoDir } = await setup();
    const a = await ok();
    const b = await ok();
    expect((await call("DELETE", `/api/photos/${a.id}`)).statusCode).toBe(204);
    expect(fs.readdirSync(photoDir).some((f) => f.startsWith(a.id))).toBe(false);
    expect((await call("GET", `/api/items/${item.id}/photos`)).json()[0]).toMatchObject({ id: b.id, isCover: true });
    expect((await call("DELETE", `/api/photos/${a.id}`)).statusCode).toBe(404);
    expect((await call("GET", `/api/photos/${a.id}/full`)).statusCode).toBe(404);
  });

  it("rejects bad uploads", async () => {
    const { upload } = await setup();
    const thumb = fakeJpeg(400, 300);
    expect((await upload({ photo: fakeJpeg(2000, 1500) })).statusCode).toBe(400); // no thumb
    expect((await upload({ photo: Buffer.from("png pretending"), thumb })).statusCode).toBe(415);
    expect((await upload({ photo: fakeJpeg(5000, 3000), thumb })).statusCode).toBe(413); // too many pixels
    expect((await upload({ photo: fakeJpeg(2000, 1500), thumb: fakeJpeg(1200, 900) })).statusCode).toBe(413);
    expect((await upload({ photo: fakeJpeg(2000, 1500, 9 * 1024 * 1024), thumb })).statusCode).toBe(413);
    expect((await upload({ photo: fakeJpeg(2000, 1500), thumb, extra: thumb })).statusCode).toBe(400);
    expect((await upload({ photo: fakeJpeg(2000, 1500), thumb }, 999)).statusCode).toBe(404);
  });

  it(`caps an item at ${MAX_PHOTOS_PER_ITEM} photos`, async () => {
    const { ok, upload } = await setup();
    for (let i = 0; i < MAX_PHOTOS_PER_ITEM; i++) await ok();
    expect((await upload({ photo: fakeJpeg(20, 20), thumb: fakeJpeg(10, 10) })).statusCode).toBe(409);
  });

  it("requires sign-in to view or upload", async () => {
    const { app, ok } = await setup();
    const p = await ok();
    expect((await app.inject(`/api/photos/${p.id}/thumb`)).statusCode).toBe(401);
  });

  it("only accepts bare UUIDs as photo ids", async () => {
    const { call } = await setup();
    for (const id of ["..%2F..%2Fstore.db", "abc"]) {
      expect((await call("GET", `/api/photos/${id}/full`)).statusCode).toBe(404);
    }
  });
});

describe("PhotoStore.sweep", () => {
  it("removes temp files and files without a database row", async () => {
    const { ok, db, photoDir } = await setup();
    const kept = await ok();
    fs.writeFileSync(path.join(photoDir, "00000000-0000-4000-8000-000000000000.jpg"), "orphan");
    fs.writeFileSync(path.join(photoDir, `${kept.id}.jpg.tmp`), "partial");
    const store = new PhotoStore(db, photoDir);
    expect(store.sweep()).toBe(2);
    expect(fs.readdirSync(photoDir).sort()).toEqual([`${kept.id}.jpg`, `${kept.id}.thumb.jpg`]);
  });
});
