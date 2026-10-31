import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  archiveStream,
  BackupScheduler,
  createBackup,
  extractArchive,
  listBackups,
  pruneBackups,
  restoreBackup,
} from "./backup.js";
import { openDb } from "./db.js";

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const quiet = { info: () => {}, error: () => {} };

/** A real on-disk data folder with one item, one photo, one sale. */
function liveData() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-bk-"));
  const db = openDb(path.join(dataDir, "store.db"), migrations);
  db.prepare("INSERT INTO items (number, name, price_cents, status) VALUES (150, 'Silk scarf', 4800, 'sold')").run();
  db.prepare(
    "INSERT INTO sales (item_id, sale_date, sold_cents, retail_cents, previous_status) VALUES (1, '2026-10-05', 4500, 4800, 'in_shop')",
  ).run();
  fs.mkdirSync(path.join(dataDir, "photos"));
  const pid = "11111111-1111-4111-8111-111111111111";
  db.prepare("INSERT INTO photos (id, item_id, sort_order, width, height, bytes) VALUES (?, 1, 0, 10, 10, 4)").run(pid);
  fs.writeFileSync(path.join(dataDir, "photos", `${pid}.jpg`), "full");
  fs.writeFileSync(path.join(dataDir, "photos", `${pid}.thumb.jpg`), "th");
  return { dataDir, db, backupDir: path.join(dataDir, "backups"), pid };
}

const itemNames = (dataDir: string) => {
  const db = openDb(path.join(dataDir, "store.db"), migrations);
  const names = (db.prepare("SELECT name FROM items ORDER BY id").all() as { name: string }[]).map((r) => r.name);
  db.close();
  return names;
};

describe("backups", () => {
  it("snapshots the database and photos with a manifest", async () => {
    const { db, dataDir, backupDir } = liveData();
    const b = await createBackup(db, dataDir, backupDir, new Date("2026-10-31T03:00:00Z"));
    expect(b).toMatchObject({
      name: "2026-10-31_030000",
      counts: { items: 1, sales: 1, photos: 1, expenses: 0 },
      photoFiles: 2,
    });
    expect(fs.readdirSync(b.dir).sort()).toEqual(["manifest.json", "photos", "store.db"]);
    expect(listBackups(backupDir).map((x) => x.name)).toEqual([b.name]);
  });

  it("hard-links unchanged photos instead of copying them", async () => {
    const { db, dataDir, backupDir, pid } = liveData();
    const a = await createBackup(db, dataDir, backupDir, new Date("2026-10-30T03:00:00Z"));
    const b = await createBackup(db, dataDir, backupDir, new Date("2026-10-31T03:00:00Z"));
    const ino = (dir: string) => fs.statSync(path.join(dir, "photos", `${pid}.jpg`)).ino;
    expect(ino(a.dir)).toBe(ino(b.dir));
  });

  it("keeps only the newest backups and clears abandoned partial ones", async () => {
    const { db, dataDir, backupDir } = liveData();
    for (const d of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) {
      await createBackup(db, dataDir, backupDir, new Date(`${d}T03:00:00Z`));
    }
    fs.mkdirSync(path.join(backupDir, "2026-11-01_030000.partial"));
    expect(pruneBackups(backupDir, 2).sort()).toEqual(["2026-10-28_030000", "2026-10-29_030000", "2026-11-01_030000.partial"]);
    expect(listBackups(backupDir).map((b) => b.name)).toEqual(["2026-10-31_030000", "2026-10-30_030000"]);
  });

  it("schedules a backup only when the newest is older than the interval", async () => {
    const { db, dataDir, backupDir } = liveData();
    const s = new BackupScheduler(db, dataDir, { backupDir, intervalHours: 24, keep: 5 }, quiet);
    await s.tick(new Date("2026-10-30T03:00:00Z"));
    await s.tick(new Date("2026-10-30T20:00:00Z")); // 17h later: skip
    await s.tick(new Date("2026-10-31T03:30:00Z")); // 24.5h later: back up
    expect(listBackups(backupDir).map((b) => b.name)).toEqual(["2026-10-31_033000", "2026-10-30_030000"]);
  });
});

describe("restore drill", () => {
  it("restores a backup folder exactly, keeping the replaced data aside", async () => {
    const { db, dataDir, backupDir, pid } = liveData();
    const b = await createBackup(db, dataDir, backupDir);
    // Things go wrong after the backup…
    db.prepare("INSERT INTO items (number, name) VALUES (151, 'Added later')").run();
    db.prepare("UPDATE items SET name = 'Corrupted' WHERE id = 1").run();
    fs.rmSync(path.join(dataDir, "photos", `${pid}.jpg`));
    db.close();

    const { savedTo } = restoreBackup(dataDir, b.dir);
    expect(itemNames(dataDir)).toEqual(["Silk scarf"]);
    expect(fs.readFileSync(path.join(dataDir, "photos", `${pid}.jpg`), "utf8")).toBe("full");
    expect(itemNames(savedTo)).toEqual(["Corrupted", "Added later"]); // nothing lost
  });

  it("round-trips through a downloaded .tar.gz", async () => {
    const { db, dataDir, backupDir, pid } = liveData();
    const b = await createBackup(db, dataDir, backupDir);
    const archive = path.join(os.tmpdir(), `sm-${Date.now()}.tar.gz`);
    await pipeline(archiveStream(b), fs.createWriteStream(archive));
    db.prepare("DELETE FROM sales").run();
    db.close();

    const unpacked = await extractArchive(archive, fs.mkdtempSync(path.join(os.tmpdir(), "sm-x-")));
    restoreBackup(dataDir, unpacked);
    const restored = openDb(path.join(dataDir, "store.db"), migrations);
    expect((restored.prepare("SELECT COUNT(*) AS n FROM sales").get() as { n: number }).n).toBe(1);
    expect(fs.existsSync(path.join(dataDir, "photos", `${pid}.thumb.jpg`))).toBe(true);
  });

  it("refuses a tampered or incomplete backup", async () => {
    const { db, dataDir, backupDir, pid } = liveData();
    const b = await createBackup(db, dataDir, backupDir);
    fs.rmSync(path.join(b.dir, "photos", `${pid}.thumb.jpg`));
    expect(() => restoreBackup(dataDir, b.dir)).toThrow(/missing 1 photo/);
    fs.appendFileSync(path.join(b.dir, "store.db"), "x");
    expect(() => restoreBackup(dataDir, b.dir)).toThrow(/checksum/);
    expect(itemNames(dataDir)).toEqual(["Silk scarf"]); // live data untouched
  });

  it("ignores unsafe paths in an archive", async () => {
    const tar = (await import("tar-stream")).default;
    const zlib = await import("node:zlib");
    const pack = tar.pack();
    pack.entry({ name: "../../evil.txt" }, "x");
    pack.entry({ name: "2026-10-31_030000/manifest.json" }, "{}");
    pack.finalize();
    const file = path.join(os.tmpdir(), `sm-evil-${Date.now()}.tar.gz`);
    await pipeline(pack, zlib.createGzip(), fs.createWriteStream(file));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), "sm-ev-"));
    await extractArchive(file, dest);
    expect(fs.existsSync(path.join(dest, "..", "..", "evil.txt"))).toBe(false);
    expect(fs.existsSync(path.join(dest, "2026-10-31_030000", "manifest.json"))).toBe(true);
  });
});

describe("backup API", () => {
  it("backs up on demand, lists, and downloads a .tar.gz for signed-in users", async () => {
    const { signedIn } = await import("./testing.js");
    const { call, app } = await signedIn();
    await call("POST", "/api/items", { name: "Scarf", number: 7 });
    const made = await call("POST", "/api/backups");
    expect(made.statusCode).toBe(201);
    const { name } = made.json();
    const list = (await call("GET", "/api/backups")).json();
    expect(list).toMatchObject({ intervalHours: 24, keep: 3, lastError: null });
    expect(list.backups[0]).toMatchObject({ name, counts: { items: 1 } });
    expect(list.backups[0].dir).toBeUndefined(); // no server paths in the API

    const dl = await call("GET", `/api/backups/${name}/download`);
    expect(dl.headers["content-type"]).toBe("application/gzip");
    expect(dl.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect((await call("GET", "/api/backups/../download")).statusCode).toBe(404);
    expect((await app.inject(`/api/backups/${name}/download`)).statusCode).toBe(401);
  });
});
