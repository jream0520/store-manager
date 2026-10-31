import { describe, expect, it } from "vitest";
import { signedIn } from "./testing.js";

async function setup() {
  const ctx = await signedIn();
  const mk = async (name: string, priceCents: number, costCents: number | null = null) =>
    (await ctx.call("POST", "/api/items", { name, priceCents, costCents })).json();
  const scarf = await mk("Scarf", 4800, 1200);
  const hoops = await mk("Hoops", 2200);
  const hat = await mk("Hat", 3500, 900);
  await ctx.call("POST", "/api/items/status", {
    ids: [scarf.id, hoops.id],
    action: "place",
    date: "2026-10-01",
    location: "Front table",
  });
  const sell = (body: object) => ctx.call("POST", "/api/sales", body);
  const get = async (id: number) => (await ctx.call("GET", `/api/items/${id}`)).json();
  const report = async (body: object = {}) =>
    (await ctx.call("POST", "/api/reports", { periodStart: "2026-10-01", periodEnd: "2026-10-15", ...body })).json();
  return { ...ctx, scarf, hoops, hat, sell, get, report };
}

describe("selling", () => {
  it("sells an in-shop item at retail by default, closing its placement", async () => {
    const { sell, scarf, get, db } = await setup();
    const res = await sell({ itemId: scarf.id, saleDate: "2026-10-05" });
    expect(res.statusCode).toBe(201);
    const { sale, item } = res.json();
    expect(sale).toMatchObject({
      itemNumber: scarf.id,
      soldCents: 4800,
      retailCents: 4800,
      profitCents: 3600,
      priceDiffers: false,
      notInShop: false,
    });
    expect(item).toMatchObject({ status: "sold", placedOn: null, sale: { id: sale.id, soldCents: 4800 } });
    expect((await get(scarf.id)).sale.saleDate).toBe("2026-10-05");
    expect(db.prepare("SELECT removed_on FROM placements WHERE item_id = ?").get(scarf.id)).toEqual({
      removed_on: "2026-10-05",
    });
  });

  it("flags a different price and leaves profit null without a cost", async () => {
    const { sell, hoops } = await setup();
    const { sale } = (await sell({ itemId: hoops.id, saleDate: "2026-10-05", soldCents: 2000 })).json();
    expect(sale).toMatchObject({ soldCents: 2000, priceDiffers: true, profitCents: null });
  });

  it("rejects a duplicate, returning the existing sale", async () => {
    const { sell, scarf } = await setup();
    const first = (await sell({ itemId: scarf.id, saleDate: "2026-10-05" })).json();
    const dup = await sell({ itemId: scarf.id, saleDate: "2026-10-06" });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ code: "duplicate", sale: { id: first.sale.id, saleDate: "2026-10-05" } });
  });

  it("needs confirmation to sell an item that isn't in the shop", async () => {
    const { sell, hat } = await setup();
    const res = await sell({ itemId: hat.id, saleDate: "2026-10-05" });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "not_in_shop", status: "in_studio" });
    const ok = await sell({ itemId: hat.id, saleDate: "2026-10-05", allowNotInShop: true });
    expect(ok.json().sale.notInShop).toBe(true);
  });

  it("rejects unknown numbers, written-off items and bad dates", async () => {
    const { sell, call, hat, scarf } = await setup();
    expect((await sell({ itemId: 999, saleDate: "2026-10-05" })).json().code).toBe("not_found");
    await call("POST", "/api/items/status", { ids: [hat.id], action: "write_off", reason: "lost" });
    const wo = await sell({ itemId: hat.id, saleDate: "2026-10-05", allowNotInShop: true });
    expect(wo.json()).toMatchObject({ code: "not_sellable", status: "written_off" });
    expect((await sell({ itemId: hat.id, saleDate: "2999-01-01" })).statusCode).toBe(400);
    expect((await sell({ itemId: scarf.id, saleDate: "2026-10-05", reportId: 999 })).statusCode).toBe(400);
  });

  it("can't be undone through status actions; sold items aren't placeable", async () => {
    const { sell, scarf, call } = await setup();
    await sell({ itemId: scarf.id, saleDate: "2026-10-05" });
    const res = await call("POST", "/api/items/status", { ids: [scarf.id], action: "place" });
    expect(res.statusCode).toBe(409);
  });
});

describe("editing and undoing a sale", () => {
  it("edits price, date and note", async () => {
    const { sell, scarf, call } = await setup();
    const { sale } = (await sell({ itemId: scarf.id, saleDate: "2026-10-05" })).json();
    const res = await call("PATCH", `/api/sales/${sale.id}`, { soldCents: 4500, saleDate: "2026-10-06", note: "cash" });
    expect(res.json()).toMatchObject({ soldCents: 4500, saleDate: "2026-10-06", note: "cash", priceDiffers: true });
    expect((await call("PATCH", "/api/sales/999", { note: "x" })).statusCode).toBe(404);
    expect((await call("GET", `/api/sales/${sale.id}`)).json()).toMatchObject({ id: sale.id, note: "cash" });
    expect((await call("GET", "/api/sales/999")).statusCode).toBe(404);
  });

  it("undoes a sale, restoring the shop placement and logging history", async () => {
    const { sell, scarf, call, get } = await setup();
    const { sale } = (await sell({ itemId: scarf.id, saleDate: "2026-10-05" })).json();
    const res = await call("DELETE", `/api/sales/${sale.id}`);
    expect(res.statusCode).toBe(200);
    expect(await get(scarf.id)).toMatchObject({
      status: "in_shop",
      placedOn: "2026-10-01",
      location: "Front table",
      sale: null,
    });
    const history = (await call("GET", `/api/items/${scarf.id}/history`)).json();
    expect(history.slice(0, 2).map((h: { from: string; to: string }) => `${h.from}>${h.to}`)).toEqual([
      "sold>in_shop",
      "in_shop>sold",
    ]);
    // Can be sold again afterwards.
    expect((await sell({ itemId: scarf.id, saleDate: "2026-10-07" })).statusCode).toBe(201);
  });

  it("undoes a not-in-shop sale back to the studio", async () => {
    const { sell, hat, call, get } = await setup();
    const { sale } = (await sell({ itemId: hat.id, saleDate: "2026-10-05", allowNotInShop: true })).json();
    await call("DELETE", `/api/sales/${sale.id}`);
    expect(await get(hat.id)).toMatchObject({ status: "in_studio", placedOn: null });
  });
});

describe("shop reports and reconciliation", () => {
  it("creates a report and tracks what's been entered against it", async () => {
    const { report, sell, scarf, hoops, call } = await setup();
    const r = await report({ reportedCount: 2, reportedTotalCents: 7000, receivedOn: "2026-10-16" });
    expect(r).toMatchObject({ enteredCount: 0, enteredTotalCents: 0, reportedTotalCents: 7000, reconciled: false });
    await sell({ itemId: scarf.id, saleDate: "2026-10-05", reportId: r.id });
    await sell({ itemId: hoops.id, saleDate: "2026-10-09", soldCents: 2000, reportId: r.id });
    const got = (await call("GET", `/api/reports/${r.id}`)).json();
    expect(got).toMatchObject({ enteredCount: 2, enteredTotalCents: 6800 });

    const sales = (await call("GET", `/api/sales?reportId=${r.id}`)).json();
    // Hoops has no cost yet: counted at zero cost and flagged.
    expect(sales).toMatchObject({ count: 2, totalCents: 6800, profitCents: 3600 + 2000, missingCostCount: 1 });
    expect(sales.sales.map((s: { itemName: string }) => s.itemName)).toEqual(["Hoops", "Scarf"]);
  });

  it("lists reports newest period first and marks one reconciled", async () => {
    const { report, call } = await setup();
    const a = await report();
    const b = await report({ periodStart: "2026-10-16", periodEnd: "2026-10-31" });
    expect((await call("GET", "/api/reports")).json().map((r: { id: number }) => r.id)).toEqual([b.id, a.id]);
    const done = (await call("PATCH", `/api/reports/${a.id}`, { reconciled: true, reportedTotalCents: 100 })).json();
    expect(done).toMatchObject({ reconciled: true, reportedTotalCents: 100 });
    expect((await call("PATCH", `/api/reports/${a.id}`, { reconciled: false })).json().reconciled).toBe(false);
  });

  it("validates report dates", async () => {
    const { call } = await setup();
    const post = (b: object) => call("POST", "/api/reports", b);
    expect((await post({ periodStart: "2026-10-15", periodEnd: "2026-10-01" })).statusCode).toBe(400);
    expect((await post({ periodStart: "2026-10-01", periodEnd: "2999-10-15" })).statusCode).toBe(400);
    expect((await post({ periodStart: "2026-10-01" })).statusCode).toBe(400);
  });

  it("deleting a report keeps its sales", async () => {
    const { report, sell, scarf, call, get } = await setup();
    const r = await report();
    await sell({ itemId: scarf.id, saleDate: "2026-10-05", reportId: r.id });
    expect((await call("DELETE", `/api/reports/${r.id}`)).statusCode).toBe(204);
    expect((await get(scarf.id)).sale).toMatchObject({ reportId: null });
  });

  it("filters sales by date range", async () => {
    const { sell, scarf, hoops, call } = await setup();
    await sell({ itemId: scarf.id, saleDate: "2026-10-05" });
    await sell({ itemId: hoops.id, saleDate: "2026-10-20" });
    const res = (await call("GET", "/api/sales?from=2026-10-10&to=2026-10-31")).json();
    expect(res.sales.map((s: { itemName: string }) => s.itemName)).toEqual(["Hoops"]);
  });
});
