import path from "node:path";

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  /** Where backups go. Defaults to <data>/backups; point it at another disk to survive a disk failure. */
  backupDir: string;
  /** Hours between automatic backups; 0 turns them off. */
  backupIntervalHours: number;
  /** How many backups to keep. */
  backupKeep: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.DATA_DIR ?? "./data");
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? "0.0.0.0",
    dataDir,
    webDir: path.resolve(env.WEB_DIR ?? "../web/dist"),
    backupDir: path.resolve(env.BACKUP_DIR || path.join(dataDir, "backups")),
    backupIntervalHours: num(env.BACKUP_INTERVAL_HOURS, 24),
    backupKeep: Math.max(1, num(env.BACKUP_KEEP, 14)),
  };
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : fallback;
}
