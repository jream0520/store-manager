import type { FastifyInstance, FastifyReply } from "fastify";
import fastifyMultipart from "@fastify/multipart";
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { idParams } from "./categories.js";
import { jpegSize } from "./jpeg.js";

// The phone resizes and re-encodes every photo before upload (see web/src/lib/image.ts) and
// sends a thumbnail alongside it, so the server only validates and stores JPEGs.

export const MAX_PHOTOS_PER_ITEM = 12;
const MAX_FULL_BYTES = 8 * 1024 * 1024;
const MAX_THUMB_BYTES = 1024 * 1024;
const MAX_FULL_EDGE = 4096;
const MAX_THUMB_EDGE = 800;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Photo {
  id: string;
  itemId: number;
  width: number;
  height: number;
  bytes: number;
  isCover: boolean;
  createdAt: string;
}

interface PhotoRow {
  id: string;
  item_id: number;
  sort_order: number;
  width: number;
  height: number;
  bytes: number;
  created_at: string;
}

export class PhotoStore {
  constructor(
    private readonly db: Database.Database,
    readonly dir: string,
  ) {}

  fullPath = (id: string) => path.join(this.dir, `${id}.jpg`);
  thumbPath = (id: string) => path.join(this.dir, `${id}.thumb.jpg`);

  list(itemId: number): Photo[] {
    const rows = this.db
      .prepare("SELECT * FROM photos WHERE item_id = ? ORDER BY sort_order, created_at")
      .all(itemId) as PhotoRow[];
    return rows.map((r, i) => toPhoto(r, i === 0));
  }

  get(id: string): PhotoRow | undefined {
    if (!ID_RE.test(id)) return undefined;
    return this.db.prepare("SELECT * FROM photos WHERE id = ?").get(id) as PhotoRow | undefined;
  }

  count(itemId: number): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM photos WHERE item_id = ?").get(itemId) as { n: number }).n;
  }

  /**
   * Writes both files under temp names, records the row, then renames them into place.
   * A crash mid-way leaves only temp files or an unreferenced file, which `sweep` removes.
   */
  add(itemId: number, full: Buffer, thumb: Buffer, size: { width: number; height: number }): Photo {
    fs.mkdirSync(this.dir, { recursive: true });
    const id = randomUUID();
    const tmpFull = `${this.fullPath(id)}.tmp`;
    const tmpThumb = `${this.thumbPath(id)}.tmp`;
    fs.writeFileSync(tmpFull, full);
    fs.writeFileSync(tmpThumb, thumb);
    try {
      this.db
        .prepare(
          `INSERT INTO photos (id, item_id, sort_order, width, height, bytes)
           VALUES (?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM photos WHERE item_id = ?), ?, ?, ?)`,
        )
        .run(id, itemId, itemId, size.width, size.height, full.length);
    } catch (e) {
      fs.rmSync(tmpFull, { force: true });
      fs.rmSync(tmpThumb, { force: true });
      throw e;
    }
    fs.renameSync(tmpFull, this.fullPath(id));
    fs.renameSync(tmpThumb, this.thumbPath(id));
    return this.list(itemId).find((p) => p.id === id)!;
  }

  /** Sets the order; `ids` must be exactly the item's photos. The first becomes the cover. */
  reorder(itemId: number, ids: string[]): boolean {
    const current = this.list(itemId).map((p) => p.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.includes(id))) {
      return false;
    }
    const upd = this.db.prepare("UPDATE photos SET sort_order = ? WHERE id = ?");
    this.db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
    return true;
  }

  remove(id: string): boolean {
    const r = this.db.prepare("DELETE FROM photos WHERE id = ?").run(id);
    if (!r.changes) return false;
    fs.rmSync(this.fullPath(id), { force: true });
    fs.rmSync(this.thumbPath(id), { force: true });
    return true;
  }

  /** Removes temp files and files with no database row (e.g. after a crash). Returns the count. */
  sweep(): number {
    if (!fs.existsSync(this.dir)) return 0;
    const known = new Set(
      (this.db.prepare("SELECT id FROM photos").all() as { id: string }[]).map((r) => r.id),
    );
    let removed = 0;
    for (const f of fs.readdirSync(this.dir)) {
      const id = f.split(".")[0];
      if (f.endsWith(".tmp") || !known.has(id)) {
        fs.rmSync(path.join(this.dir, f), { force: true });
        removed++;
      }
    }
    return removed;
  }
}

function toPhoto(r: PhotoRow, isCover: boolean): Photo {
  return {
    id: r.id,
    itemId: r.item_id,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    isCover,
    createdAt: r.created_at,
  };
}

export function photoRoutes(db: Database.Database, store: PhotoStore) {
  return async function (app: FastifyInstance) {
    await app.register(fastifyMultipart, {
      limits: { fileSize: MAX_FULL_BYTES, files: 2, fields: 0, parts: 2 },
    });

    const itemExists = (id: number) => !!db.prepare("SELECT 1 FROM items WHERE id = ?").get(id);

    app.get<{ Params: { id: number } }>("/api/items/:id/photos", { schema: { params: idParams } }, async (req, reply) => {
      if (!itemExists(req.params.id)) return notFound(reply);
      return store.list(req.params.id);
    });

    // multipart/form-data with two JPEG files: "photo" (≤ 4096 px) and "thumb" (≤ 800 px).
    app.post<{ Params: { id: number } }>(
      "/api/items/:id/photos",
      { schema: { params: idParams } },
      async (req, reply) => {
        const itemId = req.params.id;
        if (!itemExists(itemId)) return notFound(reply);
        if (store.count(itemId) >= MAX_PHOTOS_PER_ITEM) {
          return reply.code(409).send({ error: `an item can have at most ${MAX_PHOTOS_PER_ITEM} photos` });
        }
        if (!req.isMultipart()) return reply.code(415).send({ error: "expected multipart/form-data" });

        const files: Record<string, Buffer> = {};
        try {
          for await (const part of req.parts()) {
            if (part.type !== "file" || (part.fieldname !== "photo" && part.fieldname !== "thumb")) {
              return reply.code(400).send({ error: "unexpected form field" });
            }
            files[part.fieldname] = await part.toBuffer();
          }
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: "photo is too large" });
          if (code === "FST_PARTS_LIMIT" || code === "FST_FILES_LIMIT" || code === "FST_FIELDS_LIMIT") {
            return reply.code(400).send({ error: "unexpected form field" });
          }
          throw e;
        }

        const { photo, thumb } = files;
        if (!photo || !thumb) return reply.code(400).send({ error: "both photo and thumb are required" });
        const size = jpegSize(photo);
        const thumbSize = jpegSize(thumb);
        if (!size || !thumbSize) return reply.code(415).send({ error: "photo and thumb must be JPEG images" });
        if (Math.max(size.width, size.height) > MAX_FULL_EDGE || thumb.length > MAX_THUMB_BYTES ||
            Math.max(thumbSize.width, thumbSize.height) > MAX_THUMB_EDGE) {
          return reply.code(413).send({ error: "photo dimensions are too large" });
        }
        return reply.code(201).send(store.add(itemId, photo, thumb, size));
      },
    );

    app.put<{ Params: { id: number }; Body: { ids: string[] } }>(
      "/api/items/:id/photos/order",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            required: ["ids"],
            additionalProperties: false,
            properties: { ids: { type: "array", maxItems: MAX_PHOTOS_PER_ITEM, items: { type: "string" } } },
          },
        },
      },
      async (req, reply) => {
        if (!itemExists(req.params.id)) return notFound(reply);
        if (!store.reorder(req.params.id, req.body.ids)) {
          return reply.code(400).send({ error: "ids must list each of the item's photos exactly once" });
        }
        return store.list(req.params.id);
      },
    );

    app.delete<{ Params: { pid: string } }>("/api/photos/:pid", async (req, reply) => {
      if (!store.get(req.params.pid)) return notFound(reply);
      store.remove(req.params.pid);
      return reply.code(204).send();
    });

    // Photo files never change (new uploads get new ids), so browsers may cache them forever.
    for (const variant of ["full", "thumb"] as const) {
      app.get<{ Params: { pid: string } }>(`/api/photos/:pid/${variant}`, async (req, reply) => {
        if (!store.get(req.params.pid)) return notFound(reply);
        const file = variant === "full" ? store.fullPath(req.params.pid) : store.thumbPath(req.params.pid);
        if (!fs.existsSync(file)) return notFound(reply);
        return reply
          .type("image/jpeg")
          .header("cache-control", "private, max-age=31536000, immutable")
          .send(fs.createReadStream(file));
      });
    }
  };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "not found" });
}
