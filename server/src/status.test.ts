import { describe, expect, it } from "vitest";
import { isValidDay } from "./status.js";
import { signedIn } from "./testing.js";

async function setup(n = 3) {
  const ctx = await signedIn();
  const items = [];
  for (let i = 0; i < n; i++) {
    items.push((await ctx.call("POST", "/api/items", { name: `Item ${i + 1}`, priceCents: (i + 1) * 1000 })).json());
  }
  const act = (body: object) => ctx.call("POST", "/api/items/status", body);
  const get = async (id: number) => (await ctx.call("GET", `/api/items/${id}`)).json();
  const history = async (id: number) => (await ctx.call("GET", `/api/items/${id}/history`)).json();
  return { ...ctx, items, ids: items.map((i) => i.id as number), act, get, history };
}

describe("placing items in the shop", () => {
  it("places items in bulk with a date and location", async () => {
    const { act, ids, get } = await setup();
    const res = await act({ ids, action: "place", date: "2026-10-01", location: "Front table" });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toHaveLength(3);
    expect(await get(ids[0])).toMatchObject({ status: "in_shop", placedOn: "2026-10-01", location: "Front table" });
  });

  it("lists what's in the shop with the total retail value of all matches", async () => {
    const { act, ids, call } = await setup();
    await act({ ids: [ids[0], ids[2]], action: "place", date: "2026-10-01" });
    const res = (await call("GET", "/api/items?status=in_shop&limit=1")).json();
    expect(res.total).toBe(2);
    expect(res.totalPriceCents).toBe(1000 + 3000); // across both, though only one is on this page
  });

  it("sorts by placement date, oldest first", async () => {
    const { act, ids, call } = await setup();
    await act({ ids: [ids[2]], action: "place", date: "2026-09-01" });
    await act({ ids: [ids[0]], action: "place", date: "2026-10-01" });
    const res = (await call("GET", "/api/items?status=in_shop&sort=placed")).json();
    expect(res.items.map((i: { id: number }) => i.id)).toEqual([ids[2], ids[0]]);
  });

  it("edits the location of a placed item only", async () => {
    const { act, ids, call } = await setup();
    await act({ ids: [ids[0]], action: "place" });
    const ok = await call("PATCH", `/api/items/${ids[0]}/placement`, { location: "Window" });
    expect(ok.json().location).toBe("Window");
    expect((await call("PATCH", `/api/items/${ids[1]}/placement`, { location: "x" })).statusCode).toBe(409);
  });
});

describe("status transitions", () => {
  it("pulls items back to the studio and closes the placement", async () => {
    const { act, ids, get, db } = await setup(1);
    await act({ ids, action: "place", date: "2026-10-01" });
    expect((await act({ ids, action: "pull", date: "2026-10-20" })).statusCode).toBe(200);
    expect(await get(ids[0])).toMatchObject({ status: "in_studio", placedOn: null, location: null });
    expect(db.prepare("SELECT placed_on, removed_on FROM placements").all()).toEqual([
      { placed_on: "2026-10-01", removed_on: "2026-10-20" },
    ]);
  });

  it("writes off with a reason and restores", async () => {
    const { act, ids, get, history } = await setup(1);
    await act({ ids, action: "place" });
    expect((await act({ ids, action: "write_off" })).statusCode).toBe(400); // reason required
    await act({ ids, action: "write_off", reason: "damaged", note: "water stain", date: "2026-10-05" });
    expect((await get(ids[0])).status).toBe("written_off");
    expect((await history(ids[0]))[0]).toMatchObject({ to: "written_off", note: "damaged: water stain", on: "2026-10-05" });
    await act({ ids, action: "restore" });
    expect((await get(ids[0])).status).toBe("in_studio");
  });

  it("is all-or-nothing when any item can't make the change", async () => {
    const { act, ids, get } = await setup();
    await act({ ids: [ids[0]], action: "place" });
    const res = await act({ ids, action: "place" }); // ids[0] is already in the shop
    expect(res.statusCode).toBe(409);
    expect(res.json().conflicts).toEqual([{ id: ids[0], status: "in_shop" }]);
    expect((await get(ids[1])).status).toBe("in_studio"); // untouched
  });

  it("rejects unknown items, bad dates and selling (that's M5)", async () => {
    const { act, ids } = await setup(1);
    const missing = await act({ ids: [ids[0], 999], action: "place" });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().missing).toEqual([999]);
    expect((await act({ ids, action: "place", date: "2026-02-30" })).statusCode).toBe(400);
    expect((await act({ ids, action: "place", date: "2999-01-01" })).statusCode).toBe(400);
    expect((await act({ ids, action: "sell" })).statusCode).toBe(400);
    expect((await act({ ids: [], action: "place" })).statusCode).toBe(400);
  });

  it("can't change status through the item edit endpoint", async () => {
    const { call, ids } = await setup(1);
    expect((await call("PATCH", `/api/items/${ids[0]}`, { status: "in_shop" })).statusCode).toBe(400);
  });
});

describe("history", () => {
  it("records status changes and price changes, newest first", async () => {
    const { act, ids, call, history } = await setup(1);
    await act({ ids, action: "place", date: "2026-10-01", location: "Shelf A" });
    await call("PATCH", `/api/items/${ids[0]}`, { priceCents: 1500 });
    await call("PATCH", `/api/items/${ids[0]}`, { priceCents: 1500, name: "Renamed" }); // same price: no entry
    await act({ ids, action: "pull", date: "2026-10-02" });

    const h = await history(ids[0]);
    expect(h.map((e: { type: string; to?: string }) => e.to ?? e.type)).toEqual(["in_studio", "price", "in_shop"]);
    expect(h[1]).toMatchObject({ type: "price", oldCents: 1000, newCents: 1500 });
    expect(h[2]).toMatchObject({ from: "in_studio", to: "in_shop", on: "2026-10-01", note: "Shelf A" });
  });

  it("404s for unknown items", async () => {
    const { call } = await setup(0);
    expect((await call("GET", "/api/items/999/history")).statusCode).toBe(404);
  });
});

describe("isValidDay", () => {
  it("accepts real dates up to tomorrow", () => {
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay(new Date().toISOString().slice(0, 10))).toBe(true);
    expect(isValidDay("2023-02-29")).toBe(false);
    expect(isValidDay("2026-1-5")).toBe(false);
    expect(isValidDay("yesterday")).toBe(false);
  });
});
