import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { logAuthEvent } from "./audit.js";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;

export const SESSION_COOKIE = "sm_session";
const SESSION_DAYS = 90;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const MIN_PASSWORD_LENGTH = 10;

// ---- password hashing (scrypt, no native deps) ----

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scryptAsync(password, Buffer.from(salt, "base64"), want.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return timingSafeEqual(got, want);
}

/** Sets (or replaces) the owner's password and signs out every session. */
export async function setPassword(db: Database.Database, password: string): Promise<void> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const hash = await hashPassword(password);
  db.transaction(() => {
    db.prepare(
      `INSERT INTO users (id, password_hash) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = datetime('now')`,
    ).run(hash);
    db.prepare("DELETE FROM sessions").run();
  })();
}

function passwordHash(db: Database.Database): string | undefined {
  return (db.prepare("SELECT password_hash FROM users WHERE id = 1").get() as { password_hash: string } | undefined)
    ?.password_hash;
}

// ---- sessions ----

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function createSession(db: Database.Database, userAgent: string | undefined): string {
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    `INSERT INTO sessions (token_hash, expires_at, user_agent) VALUES (?, datetime('now', ?), ?)`,
  ).run(sha256(token), `+${SESSION_DAYS} days`, userAgent?.slice(0, 200) ?? null);
  return token;
}

/** Returns true for a live session and slides its expiry forward (at most once an hour). */
function touchSession(db: Database.Database, token: string): boolean {
  const hash = sha256(token);
  const row = db
    .prepare("SELECT last_seen_at FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .get(hash) as { last_seen_at: string } | undefined;
  if (!row) return false;
  db.prepare(
    `UPDATE sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?)
     WHERE token_hash = ? AND last_seen_at < datetime('now', '-1 hour')`,
  ).run(`+${SESSION_DAYS} days`, hash);
  return true;
}

// ---- login rate limiting (in memory; single process) ----

export class LoginLimiter {
  private perIp = new Map<string, number[]>();
  private all: number[] = [];

  constructor(
    private readonly maxPerIp = 5,
    private readonly maxGlobal = 20,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now = () => Date.now(),
  ) {}

  /** Seconds until another attempt is allowed, or 0 if allowed now. */
  retryAfter(ip: string): number {
    const cutoff = this.now() - this.windowMs;
    const mine = (this.perIp.get(ip) ?? []).filter((t) => t > cutoff);
    this.all = this.all.filter((t) => t > cutoff);
    const blockers = [
      mine.length >= this.maxPerIp ? mine[mine.length - this.maxPerIp] : undefined,
      this.all.length >= this.maxGlobal ? this.all[this.all.length - this.maxGlobal] : undefined,
    ].filter((t): t is number => t !== undefined);
    if (!blockers.length) return 0;
    return Math.ceil((Math.max(...blockers) + this.windowMs - this.now()) / 1000);
  }

  fail(ip: string): void {
    const t = this.now();
    this.perIp.set(ip, [...(this.perIp.get(ip) ?? []), t].slice(-this.maxPerIp));
    this.all.push(t);
  }

  succeed(ip: string): void {
    this.perIp.delete(ip);
  }
}

// ---- routes and guard ----

const PUBLIC_API = new Set(["/api/health", "/api/auth/state", "/api/auth/login"]);
// Cross-site forms can't set custom headers, and a cross-origin fetch with one needs a CORS
// preflight we never grant, so requiring it on writes blocks CSRF alongside SameSite cookies.
export const CSRF_HEADER = "x-requested-with";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function authPlugin(db: Database.Database, limiter = new LoginLimiter()) {
  return async function (app: FastifyInstance) {
    app.addHook("onRequest", async (req, reply) => {
      const url = req.url.split("?")[0];
      if (!url.startsWith("/api/")) return;
      if (!SAFE_METHODS.has(req.method) && req.headers[CSRF_HEADER] !== "store-manager") {
        return reply.code(403).send({ error: "missing request header" });
      }
      if (PUBLIC_API.has(url)) return;
      if (!isSignedIn(req, db)) return reply.code(401).send({ error: "sign in required" });
    });

    app.get("/api/auth/state", async (req) => ({
      authenticated: isSignedIn(req, db),
      setupRequired: !passwordHash(db),
    }));

    app.post<{ Body: { password: string } }>(
      "/api/auth/login",
      {
        schema: {
          body: {
            type: "object",
            required: ["password"],
            properties: { password: { type: "string", maxLength: 1024 } },
          },
        },
      },
      async (req, reply) => {
        const wait = limiter.retryAfter(req.ip);
        if (wait > 0) {
          return reply.code(429).header("retry-after", String(wait)).send({ error: "too many attempts", retryAfter: wait });
        }
        const stored = passwordHash(db);
        if (!stored) return reply.code(409).send({ error: "no password set on the server yet" });
        if (!(await verifyPassword(req.body.password, stored))) {
          limiter.fail(req.ip);
          logAuthEvent(db, "login_failed", req);
          return reply.code(401).send({ error: "wrong password" });
        }
        limiter.succeed(req.ip);
        logAuthEvent(db, "login", req);
        db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
        setSessionCookie(req, reply, createSession(db, req.headers["user-agent"]));
        return { authenticated: true };
      },
    );

    app.post("/api/auth/logout", async (req, reply) => {
      const token = req.cookies[SESSION_COOKIE];
      if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
      logAuthEvent(db, "logout", req);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { authenticated: false };
    });

    // For a lost phone: ends every session, including this one.
    app.post("/api/auth/logout-all", async (req, reply) => {
      db.prepare("DELETE FROM sessions").run();
      logAuthEvent(db, "signed_out_everywhere", req);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { authenticated: false };
    });

    app.post<{ Body: { current: string; next: string } }>(
      "/api/auth/password",
      {
        schema: {
          body: {
            type: "object",
            required: ["current", "next"],
            properties: {
              current: { type: "string", maxLength: 1024 },
              next: { type: "string", minLength: MIN_PASSWORD_LENGTH, maxLength: 1024 },
            },
          },
        },
      },
      async (req, reply) => {
        const stored = passwordHash(db);
        if (!stored || !(await verifyPassword(req.body.current, stored))) {
          return reply.code(400).send({ error: "current password is wrong" });
        }
        await setPassword(db, req.body.next); // also ends all sessions
        logAuthEvent(db, "password_changed", req);
        setSessionCookie(req, reply, createSession(db, req.headers["user-agent"]));
        return { ok: true };
      },
    );
  };
}

function isSignedIn(req: FastifyRequest, db: Database.Database): boolean {
  const token = req.cookies[SESSION_COOKIE];
  return !!token && touchSession(db, token);
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}
