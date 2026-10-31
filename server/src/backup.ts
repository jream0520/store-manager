import type Database from "better-sqlite3";
import BetterSqlite from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import tar from "tar-stream";

// Backups (F29). A backup is a folder: store.db (an online SQLite snapshot), photos/, and
// manifest.json. Photos never change once written, so each backup hard-links them from the
// previous backup or the live folder when it can; daily backups then cost little extra space.

export const NAME_RE = /^\d{4}-\d{2}-\d{2}_\d{6}$/;

export interface Manifest {
  name: string;
  createdAt: string;
  migrations: number;
  counts: { items: number; sales: number; photos: number; expenses: number };
  dbSha256: string;
  dbBytes: number;
  photoFiles: number;
  photoBytes: number;
}

export interface BackupInfo extends Manifest {
  dir: string;
}

export function backupName(d = new Date()): string {
  const iso = d.toISOString(); // 2026-10-31T18:00:15.123Z
  return `${iso.slice(0, 10)}_${iso.slice(11, 19).replace(/:/g, "")}`;
}

export function listBackups(backupDir: string): BackupInfo[] {
  if (!fs.existsSync(backupDir)) return [];
  return fs
    .readdirSync(backupDir)
    .filter((n) => NAME_RE.test(n) && fs.existsSync(path.join(backupDir, n, "manifest.json")))
    .map((n) => ({
      ...(JSON.parse(fs.readFileSync(path.join(backupDir, n, "manifest.json"), "utf8")) as Manifest),
      dir: path.join(backupDir, n),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Snapshots the live database and photos into backupDir/<name>/. Safe while the app is running. */
export async function createBackup(
  db: Database.Database,
  dataDir: string,
  backupDir: string,
  now = new Date(),
): Promise<BackupInfo> {
  fs.mkdirSync(backupDir, { recursive: true });
  let name = backupName(now);
  while (fs.existsSync(path.join(backupDir, name))) name = backupName(new Date(now.getTime() + 1000));
  const work = path.join(backupDir, `${name}.partial`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(path.join(work, "photos"), { recursive: true });

  try {
    const dbFile = path.join(work, "store.db");
    await db.backup(dbFile);
    // The copy inherits WAL mode, which would leave -wal/-shm files beside it whenever it's
    // opened. A plain rollback journal keeps the backup a single self-contained file.
    const copy = new BetterSqlite(dbFile);
    copy.pragma("journal_mode = DELETE");
    copy.close();
    checkIntegrity(dbFile);

    const previous = listBackups(backupDir)[0];
    const livePhotos = path.join(dataDir, "photos");
    let photoFiles = 0;
    let photoBytes = 0;
    if (fs.existsSync(livePhotos)) {
      for (const f of fs.readdirSync(livePhotos)) {
        if (f.endsWith(".tmp")) continue;
        const src = path.join(livePhotos, f);
        const dest = path.join(work, "photos", f);
        const prev = previous && path.join(previous.dir, "photos", f);
        linkOrCopy(prev && fs.existsSync(prev) ? prev : src, dest, src);
        photoFiles++;
        photoBytes += fs.statSync(dest).size;
      }
    }

    const snap = new BetterSqlite(dbFile, { readonly: true });
    const count = (t: string) => (snap.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const manifest: Manifest = {
      name,
      createdAt: now.toISOString(),
      migrations: count("schema_migrations"),
      counts: { items: count("items"), sales: count("sales"), photos: count("photos"), expenses: count("expenses") },
      dbSha256: sha256File(dbFile),
      dbBytes: fs.statSync(dbFile).size,
      photoFiles,
      photoBytes,
    };
    snap.close();
    fs.writeFileSync(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
    fs.renameSync(work, path.join(backupDir, name));
    return { ...manifest, dir: path.join(backupDir, name) };
  } catch (e) {
    fs.rmSync(work, { recursive: true, force: true });
    throw e;
  }
}

/** Keeps the newest `keep` backups and removes the rest, plus any abandoned partial ones. */
export function pruneBackups(backupDir: string, keep: number): string[] {
  if (!fs.existsSync(backupDir)) return [];
  const removed: string[] = [];
  for (const n of fs.readdirSync(backupDir)) {
    if (n.endsWith(".partial")) {
      fs.rmSync(path.join(backupDir, n), { recursive: true, force: true });
      removed.push(n);
    }
  }
  for (const b of listBackups(backupDir).slice(keep)) {
    fs.rmSync(b.dir, { recursive: true, force: true });
    removed.push(b.name);
  }
  return removed;
}

/** Streams a backup folder as a .tar.gz whose entries sit under "<name>/". */
export function archiveStream(backup: BackupInfo): NodeJS.ReadableStream {
  const pack = tar.pack();
  const gzip = zlib.createGzip({ level: 6 });
  (async () => {
    const files = ["manifest.json", "store.db", ...fs.readdirSync(path.join(backup.dir, "photos")).map((f) => `photos/${f}`)];
    for (const rel of files) {
      const full = path.join(backup.dir, rel);
      const st = fs.statSync(full);
      const entry = pack.entry({ name: `${backup.name}/${rel}`, size: st.size, mtime: st.mtime, mode: 0o644 });
      await pipeline(fs.createReadStream(full), entry);
    }
    pack.finalize();
  })().catch((e) => pack.destroy(e));
  return pack.pipe(gzip);
}

/** Unpacks a downloaded .tar.gz backup into destDir and returns the backup folder inside it. */
export async function extractArchive(file: string, destDir: string): Promise<string> {
  const extract = tar.extract();
  let root: string | undefined;
  extract.on("entry", (header, stream, next) => {
    const name = path.posix.normalize(header.name);
    const parts = name.split("/");
    const safe =
      header.type === "file" &&
      !path.posix.isAbsolute(name) &&
      !parts.includes("..") &&
      NAME_RE.test(parts[0]) &&
      (parts.length === 2 || (parts.length === 3 && parts[1] === "photos"));
    if (!safe) {
      stream.resume();
      stream.on("end", next);
      return;
    }
    root ??= parts[0];
    const out = path.join(destDir, ...parts);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    pipeline(stream, fs.createWriteStream(out)).then(() => next(), next);
  });
  await pipeline(fs.createReadStream(file), zlib.createGunzip(), extract);
  if (!root) throw new Error("That file doesn't contain a Store Manager backup.");
  return path.join(destDir, root);
}

/**
 * Replaces the live database and photos with a backup's. The app must be stopped. The
 * current data is moved aside to <data>/pre-restore-<time>/ first, so a restore can be undone.
 */
export function restoreBackup(dataDir: string, backupDir: string): { savedTo: string; manifest: Manifest } {
  const manifestFile = path.join(backupDir, "manifest.json");
  const dbFile = path.join(backupDir, "store.db");
  if (!fs.existsSync(manifestFile) || !fs.existsSync(dbFile)) throw new Error(`${backupDir} isn't a backup folder.`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as Manifest;
  if (sha256File(dbFile) !== manifest.dbSha256) throw new Error("The backup's database doesn't match its checksum.");
  checkIntegrity(dbFile);
  const photoDir = path.join(backupDir, "photos");
  const missing = fs.existsSync(photoDir) ? manifest.photoFiles - fs.readdirSync(photoDir).length : manifest.photoFiles;
  if (missing > 0) throw new Error(`The backup is missing ${missing} photo file(s).`);

  const savedTo = path.join(dataDir, `pre-restore-${backupName()}`);
  fs.mkdirSync(savedTo, { recursive: true });
  for (const f of ["store.db", "store.db-wal", "store.db-shm", "photos"]) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) fs.renameSync(p, path.join(savedTo, f));
  }
  fs.copyFileSync(dbFile, path.join(dataDir, "store.db"));
  fs.mkdirSync(path.join(dataDir, "photos"), { recursive: true });
  if (fs.existsSync(photoDir)) {
    for (const f of fs.readdirSync(photoDir)) linkOrCopy(path.join(photoDir, f), path.join(dataDir, "photos", f));
  }
  return { savedTo, manifest };
}

function linkOrCopy(src: string, dest: string, fallback = src) {
  try {
    fs.linkSync(src, dest);
  } catch {
    fs.copyFileSync(fs.existsSync(src) ? src : fallback, dest);
  }
}

function checkIntegrity(file: string) {
  const db = new BetterSqlite(file, { readonly: true });
  try {
    const r = db.pragma("integrity_check", { simple: true });
    if (r !== "ok") throw new Error(`Backup database failed its integrity check: ${r}`);
  } finally {
    db.close();
  }
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// ---- schedule ----

export interface BackupSettings {
  backupDir: string;
  intervalHours: number; // 0 disables automatic backups
  keep: number;
}

/** Makes a backup when the newest one is older than the interval; checks hourly. */
export class BackupScheduler {
  private timer?: NodeJS.Timeout;
  private running = false;
  lastError: string | null = null;

  constructor(
    private readonly db: Database.Database,
    private readonly dataDir: string,
    readonly settings: BackupSettings,
    private readonly log: { info: (o: object, m: string) => void; error: (o: object, m: string) => void },
  ) {}

  start() {
    if (this.settings.intervalHours <= 0) return;
    // Wait a minute after start-up so a crash-looping container doesn't back up on every restart.
    setTimeout(() => void this.tick(), 60_000).unref();
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    const latest = listBackups(this.settings.backupDir)[0];
    const age = latest ? now.getTime() - new Date(latest.createdAt).getTime() : Infinity;
    if (age < this.settings.intervalHours * 3600_000) return;
    await this.runNow(now);
  }

  async runNow(now = new Date()): Promise<BackupInfo> {
    if (this.running) throw new Error("A backup is already running.");
    this.running = true;
    try {
      const b = await createBackup(this.db, this.dataDir, this.settings.backupDir, now);
      const pruned = pruneBackups(this.settings.backupDir, this.settings.keep);
      this.lastError = null;
      this.log.info({ backup: b.name, pruned }, "backup created");
      return b;
    } catch (e) {
      this.lastError = (e as Error).message;
      this.log.error({ err: e }, "backup failed");
      throw e;
    } finally {
      this.running = false;
    }
  }
}
