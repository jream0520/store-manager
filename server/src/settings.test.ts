import { describe, expect, it } from "vitest";
import { signedIn } from "./testing.js";

describe("settings", () => {
  it("returns defaults, then saves changes", async () => {
    const { call } = await signedIn();
    expect((await call("GET", "/api/settings")).json()).toEqual({ shopName: "", currency: "USD" });
    const saved = (await call("PATCH", "/api/settings", { shopName: " The Boutique ", currency: "CAD" })).json();
    expect(saved).toEqual({ shopName: "The Boutique", currency: "CAD" });
    expect((await call("GET", "/api/settings")).json()).toEqual(saved);
  });

  it("rejects unknown keys and bad currency codes", async () => {
    const { call } = await signedIn();
    expect((await call("PATCH", "/api/settings", { currency: "usd" })).statusCode).toBe(400);
    expect((await call("PATCH", "/api/settings", { theme: "dark" })).statusCode).toBe(400);
    expect((await call("PATCH", "/api/settings", {})).statusCode).toBe(400);
  });
});

describe("categories", () => {
  it("creates, lists with item counts, renames and deletes", async () => {
    const { call } = await signedIn();
    const rings = (await call("POST", "/api/categories", { name: "Rings" })).json();
    await call("POST", "/api/categories", { name: "bags" });
    await call("POST", "/api/items", { name: "Ring A", categoryId: rings.id });
    const list = (await call("GET", "/api/categories")).json();
    expect(list.map((c: { name: string; itemCount: number }) => [c.name, c.itemCount])).toEqual([
      ["bags", 0],
      ["Rings", 1],
    ]);
    expect((await call("PATCH", `/api/categories/${rings.id}`, { name: "Fine rings" })).json().name).toBe("Fine rings");
    expect((await call("DELETE", `/api/categories/${rings.id}`)).statusCode).toBe(204);
    expect((await call("DELETE", `/api/categories/${rings.id}`)).statusCode).toBe(404);
  });

  it("rejects duplicate names case-insensitively and blank names", async () => {
    const { call } = await signedIn();
    await call("POST", "/api/categories", { name: "Rings" });
    expect((await call("POST", "/api/categories", { name: "rings" })).statusCode).toBe(409);
    expect((await call("POST", "/api/categories", { name: "  " })).statusCode).toBe(400);
  });
});
