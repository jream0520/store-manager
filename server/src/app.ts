import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import type { Config } from "./config.js";
import { spikePhotoRoutes } from "./spikePhotos.js";

export function buildApp(config: Config, db: Database.Database) {
  // Runs behind the host's TLS reverse proxy; trust its X-Forwarded-* headers.
  const app = Fastify({ logger: process.env.NODE_ENV !== "test", trustProxy: true });

  app.get("/api/health", async () => {
    const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    return { status: "ok", migrations: row.n };
  });

  app.register(spikePhotoRoutes(path.join(config.dataDir, "spike-photos"), config.spikeUploadKey), {
    prefix: "/api/spike/photos",
  });

  if (fs.existsSync(config.webDir)) {
    app.register(fastifyStatic, { root: config.webDir });
    // SPA fallback: unknown non-API GETs serve the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "not found" });
    });
  }

  return app;
}
