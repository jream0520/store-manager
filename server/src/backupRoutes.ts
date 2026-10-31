import type { FastifyInstance } from "fastify";
import { archiveStream, listBackups, NAME_RE, type BackupScheduler } from "./backup.js";

export function backupRoutes(scheduler: BackupScheduler) {
  return async function (app: FastifyInstance) {
    const { backupDir, intervalHours, keep } = scheduler.settings;

    app.get("/api/backups", async () => ({
      backups: listBackups(backupDir).map(({ dir: _dir, ...b }) => b),
      intervalHours,
      keep,
      lastError: scheduler.lastError,
    }));

    app.post("/api/backups", async (_req, reply) => {
      try {
        const { dir: _dir, ...b } = await scheduler.runNow();
        return reply.code(201).send(b);
      } catch (e) {
        return reply.code(500).send({ error: `Backup failed: ${(e as Error).message}` });
      }
    });

    // A single .tar.gz to keep somewhere other than this server.
    app.get<{ Params: { name: string } }>("/api/backups/:name/download", async (req, reply) => {
      const b = NAME_RE.test(req.params.name) && listBackups(backupDir).find((x) => x.name === req.params.name);
      if (!b) return reply.code(404).send({ error: "not found" });
      return reply
        .type("application/gzip")
        .header("content-disposition", `attachment; filename="store-manager-backup-${b.name}.tar.gz"`)
        .header("cache-control", "no-store")
        .send(archiveStream(b));
    });
  };
}
