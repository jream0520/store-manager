import { describe, expect, it } from "vitest";
import { toCsv } from "./exportCsv.js";
import { signedIn } from "./testing.js";

const TODAY = "2026-10-31";

async function setup() {
  const ctx = await signedIn();
  const cat = (await ctx.call("POST", "/api/categories", { name: "Scarves" })).json();
  const mk = async (body: object) => (await ctx.call("POST", "/api/items", body)).json();
  const scarf = await mk({ name: "Silk scarf", priceCents: 5000, costCents: 1000, categoryId: cat.id });
  const wool = await mk({ name: "Wool scarf", priceCents: 3000, costCents: 800, categoryId: cat.id });
  const hoops = await mk({ name: "Hoops", priceCents: 2000 }); // no cost, no category
  const hat = await mk({ name: "Hat", priceCents: 4000, costCents: 1500 });
  const studio = await mk({ name: "Studio piece", priceCents: 1000 });
  const place = (ids: number[], date: string) => ctx.call("POST", "/api/items/status", { ids, action: "place", date });
  await place([scarf.id, wool.id, hoops.id], "2026-08-01");
  await place([hat.id], "2026-10-20");
  const sell = (itemId: number, saleDate: string, soldCents?: number) =>
    ctx.call("POST", "/api/sales", { itemId, saleDate, soldCents });
  const expense = (body: object) => ctx.call("POST", "/api/expenses", body);
  return { ...ctx, cat, scarf, wool, hoops, hat, studio, sell, expense };
}

describe("expenses", () => {
  it("creates, lists by date, edits and deletes", async () => {
    const { expense, call } = await setup();
    const rent = (await expense({ spentOn: "2026-10-01", category: "rent", amountCents: 15000, note: "October booth" })).json();
    await expense({ spentOn: "2026-09-01", category: "rent", amountCents: 15000 });
    const oct = (await call("GET", "/api/expenses?from=2026-10-01&to=2026-10-31")).json();
    expect(oct.map((e: { id: number }) => e.id)).toEqual([rent.id]);
    expect((await call("PATCH", `/api/expenses/${rent.id}`, { amountCents: 16000 })).json().amountCents).toBe(16000);
    expect((await call("DELETE", `/api/expenses/${rent.id}`)).statusCode).toBe(204);
    expect((await call("DELETE", `/api/expenses/${rent.id}`)).statusCode).toBe(404);
  });

  it("validates input", async () => {
    const { expense } = await setup();
    expect((await expense({ spentOn: "2026-10-01", category: "lunch", amountCents: 100 })).statusCode).toBe(400);
    expect((await expense({ spentOn: "2026-10-01", category: "rent", amountCents: 0 })).statusCode).toBe(400);
    expect((await expense({ spentOn: "2999-10-01", category: "rent", amountCents: 100 })).statusCode).toBe(400);
  });
});

describe("dashboard", () => {
  it("counts statuses, shop value, aging, month and year totals, and recent activity", async () => {
    const { sell, expense, call, scarf, hoops } = await setup();
    await sell(scarf.id, "2026-10-05", 4500); // profit 3500
    await sell(hoops.id, "2026-09-10"); // no cost: profit 2000, flagged
    await expense({ spentOn: "2026-10-01", category: "rent", amountCents: 1000 });
    await expense({ spentOn: "2026-03-01", category: "fees", amountCents: 200 });

    const d = (await call("GET", `/api/dashboard?today=${TODAY}`)).json();
    // incomplete: the studio piece (no cost or category) and the hat (no category)
    expect(d.counts).toEqual({ inStudio: 1, inShop: 2, sold: 2, writtenOff: 0, incomplete: 2 });
    // wool (since Aug 1, 91 days) and hat (since Oct 20)
    expect(d.shop).toEqual({ count: 2, valueCents: 7000, over60Days: 1, over90Days: 1 });
    expect(d.month).toMatchObject({ salesCount: 1, salesCents: 4500, profitCents: 3500, expensesCents: 1000, netCents: 2500 });
    expect(d.year).toMatchObject({
      salesCount: 2,
      salesCents: 6500,
      profitCents: 5500,
      missingCostCount: 1,
      expensesCents: 1200,
      netCents: 4300,
    });
    expect(d.year.expensesByCategory).toMatchObject({ rent: 1000, fees: 200, supplies: 0 });
    // most recently entered first (hoops was sold last, though with an earlier date)
    expect(d.recent[0]).toMatchObject({ kind: "status", to: "sold", itemName: "Hoops", on: "2026-09-10" });
  });

  it("rejects a bad today", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/dashboard?today=2026-13-01")).statusCode).toBe(400);
  });
});

describe("analysis", () => {
  it("breaks down sales by category, top items, days to sell and month", async () => {
    const { sell, expense, call, scarf, wool, hoops } = await setup();
    await sell(scarf.id, "2026-08-11"); // 10 days after Aug 1
    await sell(wool.id, "2026-08-31"); // 30 days
    await sell(hoops.id, "2026-09-10"); // 40 days
    await expense({ spentOn: "2026-09-01", category: "rent", amountCents: 1500 });

    const a = (await call("GET", "/api/analysis?from=2026-08-01&to=2026-10-31")).json();
    expect(a.summary).toMatchObject({ salesCount: 3, salesCents: 10000, profitCents: 10000 - 1800, netCents: 8200 - 1500 });
    expect(a.byCategory).toEqual([
      { category: "Scarves", count: 2, salesCents: 8000, profitCents: 6200, avgDaysToSell: 20 },
      { category: "Uncategorized", count: 1, salesCents: 2000, profitCents: 2000, avgDaysToSell: 40 },
    ]);
    expect(a.topItems.map((t: { itemName: string }) => t.itemName)).toEqual(["Silk scarf", "Wool scarf", "Hoops"]);
    expect(a.avgDaysToSell).toBe(Math.round((10 + 30 + 40) / 3));
    expect(a.byMonth).toEqual([
      { month: "2026-08", salesCents: 8000, profitCents: 6200, expensesCents: 0, netCents: 6200 },
      { month: "2026-09", salesCents: 2000, profitCents: 2000, expensesCents: 1500, netCents: 500 },
    ]);
  });

  it("requires an ordered, valid range", async () => {
    const { call } = await setup();
    expect((await call("GET", "/api/analysis?from=2026-10-01&to=2026-09-01")).statusCode).toBe(400);
    expect((await call("GET", "/api/analysis?from=2026-10-01")).statusCode).toBe(400);
  });
});

describe("CSV export", () => {
  it("quotes, escapes and neutralizes formulas", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'say "hi"'], ["=SUM(A1)", null], [-5, "line\nbreak"]]);
    expect(csv).toBe('﻿a,b\r\n"x,y","say ""hi"""\r\n\'=SUM(A1),\r\n-5,"line\nbreak"\r\n');
  });

  it("downloads items, sales and expenses as CSV for signed-in users only", async () => {
    const { sell, expense, call, app, scarf } = await setup();
    await sell(scarf.id, "2026-10-05", 4500);
    await expense({ spentOn: "2026-10-01", category: "rent", amountCents: 15000, note: "booth, October" });

    const items = await call("GET", "/api/export/items.csv");
    expect(items.headers["content-type"]).toContain("text/csv");
    expect(items.headers["content-disposition"]).toMatch(/attachment; filename="store-manager-items-/);
    const lines = items.body.replace("﻿", "").trim().split("\r\n");
    expect(lines[0]).toMatch(/^Number,Name,Category,Status,Price/);
    expect(lines).toHaveLength(6);
    expect(lines[1]).toContain("1,Silk scarf,Scarves,sold,50.00,10.00");

    const sales = (await call("GET", "/api/export/sales.csv")).body;
    expect(sales).toContain("2026-10-05,1,Silk scarf,Scarves,45.00,50.00,10.00,35.00");
    const expenses = (await call("GET", "/api/export/expenses.csv")).body;
    expect(expenses).toContain('2026-10-01,rent,150.00,"booth, October"');

    expect((await app.inject("/api/export/items.csv")).statusCode).toBe(401);
  });
});
