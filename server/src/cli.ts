// Admin commands, run inside the container:
//   docker compose exec app node server/dist/cli.js set-password
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { MIN_PASSWORD_LENGTH, setPassword } from "./auth.js";
import { loadConfig } from "./config.js";
import { openDb } from "./db.js";

async function main() {
  const [command] = process.argv.slice(2);
  if (command !== "set-password") {
    console.error("Usage: node server/dist/cli.js set-password");
    process.exit(2);
  }

  const config = loadConfig();
  const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
  const db = openDb(path.join(config.dataDir, "store.db"), migrations);

  const first = await ask(`New password (min ${MIN_PASSWORD_LENGTH} characters): `);
  const second = process.stdin.isTTY ? await ask("Repeat it: ") : first;
  if (first !== second) throw new Error("Passwords don't match");
  await setPassword(db, first);
  console.log("Password set. All existing sessions were signed out.");
}

/** Reads a line without echoing it when attached to a terminal. */
function ask(prompt: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output, terminal: !!process.stdin.isTTY });
  process.stdout.write(prompt);
  muted = true;
  return new Promise((resolve) =>
    rl.once("line", (line) => {
      rl.close();
      process.stdout.write("\n");
      // Piped input from Windows shells can carry a UTF-8 BOM and a trailing CR.
      resolve(line.replace(/^﻿/, "").replace(/\r$/, ""));
    }),
  );
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
