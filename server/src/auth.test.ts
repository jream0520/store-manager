import { describe, expect, it } from "vitest";
import { hashPassword, LoginLimiter, SESSION_COOKIE, setPassword, verifyPassword } from "./auth.js";
import { CSRF, newApp, PASSWORD, signedIn } from "./testing.js";

const login = (app: ReturnType<typeof newApp>["app"], password: string, headers: Record<string, string> = CSRF) =>
  app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { password } });

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("abcdefghijk");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("abcdefghijk", h)).toBe(true);
    expect(await verifyPassword("abcdefghijx", h)).toBe(false);
  });

  it("rejects short passwords", async () => {
    const { db } = newApp();
    await expect(setPassword(db, "short")).rejects.toThrow(/at least 10/);
  });
});

describe("auth flow", () => {
  it("reports setup required before a password exists, and refuses login", async () => {
    const { app } = newApp();
    expect((await app.inject("/api/auth/state")).json()).toEqual({ authenticated: false, setupRequired: true });
    expect((await login(app, "anything at all")).statusCode).toBe(409);
  });

  it("blocks API access without a session", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    for (const url of ["/api/items", "/api/items/1", "/api/categories", "/api/settings"]) {
      expect((await app.inject(url)).statusCode, url).toBe(401);
    }
    const write = await app.inject({ method: "POST", url: "/api/items", headers: CSRF, payload: { name: "x" } });
    expect(write.statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
  });

  it("logs in, sets a hardened cookie, and grants access", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    const res = await login(app, PASSWORD);
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    expect(cookie.path).toBe("/");
    const headers = { cookie: `${SESSION_COOKIE}=${cookie.value}` };
    expect((await app.inject({ url: "/api/items", headers })).statusCode).toBe(200);
    expect((await app.inject({ url: "/api/auth/state", headers })).json().authenticated).toBe(true);
  });

  it("marks the cookie Secure behind an HTTPS proxy", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    const res = await login(app, PASSWORD, { ...CSRF, "x-forwarded-proto": "https" });
    expect(res.cookies.find((c) => c.name === SESSION_COOKIE)!.secure).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    const res = await login(app, "wrong password!");
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toHaveLength(0);
  });

  it("requires the CSRF header on writes", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    expect((await login(app, PASSWORD, {})).statusCode).toBe(403);
    const { call, headers, app: a2 } = await signedIn();
    expect((await call("POST", "/api/categories", { name: "Rings" })).statusCode).toBe(201);
    const { "x-requested-with": _, ...noCsrf } = headers;
    const res = await a2.inject({ method: "POST", url: "/api/categories", headers: noCsrf, payload: { name: "X" } });
    expect(res.statusCode).toBe(403);
  });

  it("logs out and invalidates the session", async () => {
    const { call } = await signedIn();
    expect((await call("POST", "/api/auth/logout")).statusCode).toBe(200);
    expect((await call("GET", "/api/items")).statusCode).toBe(401);
  });

  it("changes the password, ending other sessions but keeping this one", async () => {
    const { app, call, headers: oldHeaders } = await signedIn();
    const bad = await call("POST", "/api/auth/password", { current: "nope nope nope", next: "a new password" });
    expect(bad.statusCode).toBe(400);
    const res = await call("POST", "/api/auth/password", { current: PASSWORD, next: "a new password" });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: "/api/items", headers: oldHeaders })).statusCode).toBe(401);
    const fresh = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    const ok = await app.inject({ url: "/api/items", headers: { cookie: `${SESSION_COOKIE}=${fresh.value}` } });
    expect(ok.statusCode).toBe(200);
    expect((await login(app, "a new password")).statusCode).toBe(200);
  });
});

describe("login rate limiting", () => {
  it("locks an IP out after 5 failures, even for the right password", async () => {
    const { app, db } = newApp();
    await setPassword(db, PASSWORD);
    for (let i = 0; i < 5; i++) expect((await login(app, "wrong password!")).statusCode).toBe(401);
    const res = await login(app, PASSWORD);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("unlocks after the window passes and has a global cap", () => {
    let now = 0;
    const lim = new LoginLimiter(2, 3, 1000, () => now);
    lim.fail("a");
    lim.fail("a");
    expect(lim.retryAfter("a")).toBe(1);
    now = 1001;
    expect(lim.retryAfter("a")).toBe(0);
    lim.fail("b");
    lim.fail("c");
    lim.fail("d");
    expect(lim.retryAfter("e")).toBeGreaterThan(0); // global cap across IPs
  });

  it("clears an IP's failures after a successful login", () => {
    const lim = new LoginLimiter(2, 100, 1000, () => 0);
    lim.fail("a");
    lim.succeed("a");
    lim.fail("a");
    expect(lim.retryAfter("a")).toBe(0);
  });
});
