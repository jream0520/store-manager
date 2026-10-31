import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

// M1 device spike: proves camera capture → upload → display on a real iPhone.
// Replaced by item photos in M3. Guarded by a shared key because there is no login until M2.

const MAX_BYTES = 15 * 1024 * 1024;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SpikePhoto {
  id: string;
  size: number;
  createdAt: string;
}

export function spikePhotoRoutes(dir: string, key: string | undefined) {
  return async function (app: FastifyInstance) {
    app.addContentTypeParser("image/jpeg", { parseAs: "buffer", bodyLimit: MAX_BYTES }, (_req, body, done) =>
      done(null, body),
    );

    app.addHook("onRequest", async (req, reply) => {
      if (!key) return reply.code(503).send({ error: "photo spike disabled (SPIKE_UPLOAD_KEY not set)" });
      if (!keyMatches(req, key)) return reply.code(401).send({ error: "missing or wrong upload key" });
    });

    app.post("/", { bodyLimit: MAX_BYTES }, async (req, reply) => {
      const body = req.body;
      if (!Buffer.isBuffer(body) || !isJpeg(body)) {
        return reply.code(415).send({ error: "expected a JPEG body with Content-Type: image/jpeg" });
      }
      fs.mkdirSync(dir, { recursive: true });
      const id = randomUUID();
      fs.writeFileSync(path.join(dir, `${id}.jpg`), body);
      return reply.code(201).send(describe(dir, id));
    });

    app.get("/", async () => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jpg") && ID_RE.test(f.slice(0, -4)))
        .map((f) => describe(dir, f.slice(0, -4)))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });

    app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
      const file = photoPath(dir, req.params.id);
      if (!file) return notFound(reply);
      return reply
        .type("image/jpeg")
        .header("Cache-Control", "private, max-age=86400")
        .send(fs.createReadStream(file));
    });

    app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
      const file = photoPath(dir, req.params.id);
      if (!file) return notFound(reply);
      fs.unlinkSync(file);
      return reply.code(204).send();
    });
  };
}

function keyMatches(req: FastifyRequest, key: string): boolean {
  const given = Buffer.from(String(req.headers["x-upload-key"] ?? ""));
  const want = Buffer.from(key);
  return given.length === want.length && timingSafeEqual(given, want);
}

function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** Resolves an id to an existing file, rejecting anything that isn't a bare UUID. */
function photoPath(dir: string, id: string): string | undefined {
  if (!ID_RE.test(id)) return undefined;
  const file = path.join(dir, `${id}.jpg`);
  return fs.existsSync(file) ? file : undefined;
}

function describe(dir: string, id: string): SpikePhoto {
  const st = fs.statSync(path.join(dir, `${id}.jpg`));
  return { id, size: st.size, createdAt: st.mtime.toISOString() };
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "not found" });
}
