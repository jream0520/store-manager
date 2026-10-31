import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { auditRoutes } from "./audit.js";
import { authPlugin, LoginLimiter } from "./auth.js";
import { BackupScheduler } from "./backup.js";
import { backupRoutes } from "./backupRoutes.js";
import { categoryRoutes } from "./categories.js";
import type { Config } from "./config.js";
import { itemRoutes } from "./items.js";
import { PhotoStore, photoRoutes } from "./photos.js";
import { expenseRoutes } from "./expenses.js";
import { exportRoutes } from "./exportCsv.js";
import { insightRoutes } from "./insights.js";
import { salesRoutes } from "./sales.js";
import { settingsRoutes } from "./settings.js";
import { statusRoutes } from "./status.js";

export interface AppOptions {
  limiter?: LoginLimiter;
  /** Start the automatic backup timer (the real server does; tests don't). */
  startBackups?: boolean;
}

export function buildApp(config: Config, db: Database.Database, opts: AppOptions = {}) {
  // Runs behind the host's TLS reverse proxy; trust its X-Forwarded-* headers.
  const app = Fastify({
    logger: process.env.NODE_ENV !== "test",
    trustProxy: true,
    // Reject unknown body fields instead of silently stripping them.
    ajv: { customOptions: { removeAdditional: false } },
  });

  const photos = new PhotoStore(db, path.join(config.dataDir, "photos"));
  const swept = photos.sweep();
  if (swept) app.log.info({ swept }, "removed orphaned photo files");

  const backups = new BackupScheduler(
    db,
    config.dataDir,
    { backupDir: config.backupDir, intervalHours: config.backupIntervalHours, keep: config.backupKeep },
    app.log,
  );
  if (opts.startBackups) {
    backups.start();
    app.addHook("onClose", async () => backups.stop());
  }

  // Defence in depth for the web app; TLS and HSTS come from the reverse proxy.
  app.addHook("onSend", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "same-origin");
    reply.header("x-frame-options", "DENY");
    reply.header("permissions-policy", "geolocation=(), microphone=(), payment=(), usb=()");
    reply.header(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        // Svelte sets a few inline style attributes (e.g. chart bar widths).
        "style-src 'self' 'unsafe-inline'",
        // blob: for photo previews before upload; data: for small inline assets.
        "img-src 'self' blob: data:",
        "connect-src 'self'",
        "worker-src 'self'",
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "object-src 'none'",
      ].join("; "),
    );
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
    await api.register(photoRoutes(db, photos));
    await api.register(statusRoutes(db));
    await api.register(salesRoutes(db));
    await api.register(expenseRoutes(db));
    await api.register(insightRoutes(db));
    await api.register(exportRoutes(db));
    await api.register(backupRoutes(backups));
    await api.register(auditRoutes(db));
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
