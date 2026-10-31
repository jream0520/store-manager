import { describe, expect, it } from "vitest";
import { newApp } from "./testing.js";

describe("health", () => {
  it("reports ok and applied migrations", async () => {
    const { app } = newApp();
    const res = await app.inject("/api/health");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", migrations: 3 });
  });
});
