// Admin commands, run inside the container (see docs/OPERATIONS.md):
//   docker compose exec app node server/dist/cli.js set-password
//   docker compose exec app node server/dist/cli.js backup
//   docker compose exec app node server/dist/cli.js list-backups
//   docker compose stop app && docker compose run --rm app node server/dist/cli.js restore <name|file.tar.gz>
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { MIN_PASSWORD_LENGTH, setPassword } from "./auth.js";
import { createBackup, extractArchive, listBackups, NAME_RE, pruneBackups, restoreBackup } from "./backup.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

const USAGE = `Usage: node server/dist/cli.js <command>
  set-password             set or reset the owner's password (signs out all devices)
  backup                   make a backup now
  list-backups             show backups, newest first
  restore <name|file> [--yes]
                           replace all data with a backup (stop the app first)`;

const config = loadConfig();
const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const dbFile = path.join(config.dataDir, "store.db");

async function main() {
  const [command, arg, ...flags] = process.argv.slice(2);
  switch (command) {
    case "set-password":
      return setPasswordCmd();
    case "backup":
      return backupCmd();
    case "list-backups":
      return listCmd();
    case "restore":
      return restoreCmd(arg, flags.includes("--yes") || arg === "--yes");
    default:
      console.error(USAGE);
      process.exit(2);
  }
}

async function setPasswordCmd() {
  const db = openDb(dbFile, migrations);
  const first = await ask(`New password (min ${MIN_PASSWORD_LENGTH} characters): `);
  const second = process.stdin.isTTY ? await ask("Repeat it: ") : first;
  if (first !== second) throw new Error("Passwords don't match");
  await setPassword(db, first);
  console.log("Password set. All existing sessions were signed out.");
}

async function backupCmd() {
  const db = openDb(dbFile, migrations);
  const b = await createBackup(db, config.dataDir, config.backupDir);
  const pruned = pruneBackups(config.backupDir, config.backupKeep);
  console.log(`Backup ${b.name}: ${b.counts.items} items, ${b.counts.sales} sales, ${b.photoFiles} photo files.`);
  console.log(`Saved in ${b.dir}${pruned.length ? `; removed old: ${pruned.join(", ")}` : ""}`);
}

function listCmd() {
  const all = listBackups(config.backupDir);
  if (!all.length) return console.log(`No backups in ${config.backupDir}`);
  for (const b of all) {
    const mb = ((b.dbBytes + b.photoBytes) / 1024 / 1024).toFixed(1);
    console.log(`${b.name}  ${b.counts.items} items  ${b.counts.sales} sales  ${b.photoFiles} photo files  ${mb} MB`);
  }
}

async function restoreCmd(source: string | undefined, yes: boolean) {
  if (!source || source === "--yes") throw new Error("Say which backup: a name from list-backups, or a .tar.gz file.");

  let backupDir = "";
  let tmp: string | undefined;
  if (NAME_RE.test(source)) {
    backupDir = path.join(config.backupDir, source);
    if (!fs.existsSync(backupDir)) throw new Error(`No backup named ${source}. Run list-backups.`);
  } else if (source.endsWith(".tar.gz") || source.endsWith(".tgz")) {
    // Unpack on the data volume, not /tmp: archives can be large and /tmp is a small tmpfs.
    tmp = fs.mkdtempSync(path.join(config.dataDir, ".restore-"));
  } else {
    backupDir = path.resolve(source);
  }

  try {
    if (tmp) backupDir = await extractArchive(path.resolve(source), tmp);
    const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, "manifest.json"), "utf8"));
    console.log(`Backup ${manifest.name}: ${manifest.counts.items} items, ${manifest.counts.sales} sales, ${manifest.photoFiles} photo files.`);
    console.log("This replaces ALL current data. Make sure the app is stopped (docker compose stop app).");
    if (!yes) {
      if (!process.stdin.isTTY) throw new Error("Add --yes to restore without a prompt.");
      const answer = await ask("Type RESTORE to continue: ", false);
      if (answer.trim() !== "RESTORE") throw new Error("Cancelled.");
    }
    const { savedTo } = restoreBackup(config.dataDir, backupDir);
    // Opening applies any newer migrations to an older backup.
    openDb(dbFile, migrations).close();
    console.log(`Restored. The previous data was moved to ${savedTo}. Start the app: docker compose up -d`);
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Reads a line, hiding it when attached to a terminal (for passwords). */
function ask(prompt: string, hidden = true): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  process.stdout.write(prompt);
  muted = hidden;
  return new Promise((resolve) =>
    rl.once("line", (line) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      // Piped input from Windows shells can carry a UTF-8 BOM and a trailing CR.
      resolve(line.replace(/^﻿/, "").replace(/\r$/, ""));
    }),
  );
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
