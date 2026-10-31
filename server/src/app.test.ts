import { describe, expect, it } from "vitest";
import { newApp } from "./testing.js";

describe("health", () => {
  it("reports ok and applied migrations", async () => {
    const { app } = newApp();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations: 8 });
  });
});

describe("security headers", () => {
  it("sets a strict CSP and related headers on every response", async () => {
    const { app } = newApp();
    const res = await app.inject("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("same-origin");
    const csp = String(res.headers["content-security-policy"]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });
});
