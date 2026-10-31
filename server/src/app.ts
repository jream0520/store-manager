import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import type Database from "better-sqlite3";
import { authPlugin, LoginLimiter } from "./auth.js";
import { categoryRoutes } from "./categories.js";
import type { Config } from "./config.js";
import { itemRoutes } from "./items.js";
import { settingsRoutes } from "./settings.js";

export interface AppOptions {
  limiter?: LoginLimiter;
}

export function buildApp(config: Config, db: Database.Database, opts: AppOptions = {}) {
  // Runs behind the host's TLS reverse proxy; trust its X-Forwarded-* headers.
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
    // Reject unknown body fields instead of silently stripping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  app.register(fastifyCookie);
  app.register(async (api) => {
    // Called directly (not registered) so its guard hook covers every route in this scope.
    await authPlugin(db, opts.limiter)(api);

    api.get("/api/health", async () => {
      const row = db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
      return { status: "ok", migrations: row.n };
    });

    await api.register(settingsRoutes(db));
    await api.register(categoryRoutes(db));
    await api.register(itemRoutes(db));
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
