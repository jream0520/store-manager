import { describe, expect, it } from "vitest";
import { normalizeTags } from "./items.js";
import { signedIn } from "./testing.js";

async function withCategory(name = "Scarves") {
  const ctx = await signedIn();
  const cat = (await ctx.call("POST", "/api/categories", { name })).json();
  return { ...ctx, cat };
}

describe("items", () => {
  it("creates a complete item and reads it back", async () => {
    const { call, cat } = await withCategory();
    const res = await call("POST", "/api/items", {
      name: "  Blue silk scarf ",
      description: "Hand-dyed",
      categoryId: cat.id,
      tags: ["Silk", "blue", "silk"],
      costCents: 1250,
      priceCents: 4800,
    });
    expect(res.statusCode).toBe(201);
    const item = res.json();
    expect(item).toMatchObject({
      number: item.id,
      name: "Blue silk scarf",
      categoryName: "Scarves",
      tags: ["silk", "blue"],
      costCents: 1250,
      priceCents: 4800,
      status: "in_studio",
      archived: false,
      incomplete: false,
    });
    expect((await call("GET", `/api/items/${item.id}`)).json()).toEqual(item);
  });

  it("quick-adds with just a name and price, flagged incomplete", async () => {
    const { call } = await signedIn();
    const item = (await call("POST", "/api/items", { name: "Earrings", priceCents: 2200 })).json();
    expect(item.incomplete).toBe(true);
    const listed = (await call("GET", "/api/items?incomplete=true")).json();
    expect(listed.items.map((i: { id: number }) => i.id)).toEqual([item.id]);
  });

  it("numbers items sequentially and never reuses numbers", async () => {
    const { call, db } = await signedIn();
    const a = (await call("POST", "/api/items", { name: "A" })).json();
    const b = (await call("POST", "/api/items", { name: "B" })).json();
    expect(b.number).toBe(a.number + 1);
    db.prepare("DELETE FROM items WHERE id = ?").run(b.id); // even after a hard delete
    const c = (await call("POST", "/api/items", { name: "C" })).json();
    expect(c.number).toBe(b.number + 1);
  });

  it("validates input", async () => {
    const { call } = await signedIn();
    expect((await call("POST", "/api/items", { name: "   " })).statusCode).toBe(400);
    expect((await call("POST", "/api/items", { name: "X", priceCents: -1 })).statusCode).toBe(400);
    expect((await call("POST", "/api/items", { name: "X", priceCents: 1.5 })).statusCode).toBe(400);
    expect((await call("POST", "/api/items", { name: "X", status: "sold" })).statusCode).toBe(400);
    expect((await call("POST", "/api/items", { name: "X", categoryId: 999 })).statusCode).toBe(400);
    expect((await call("GET", "/api/items/999")).statusCode).toBe(404);
  });

  it("edits fields, clears nullable ones, and archives", async () => {
    const { call, cat } = await withCategory();
    const item = (await call("POST", "/api/items", { name: "Ring", categoryId: cat.id, costCents: 100, priceCents: 900 })).json();
    const edited = (await call("PATCH", `/api/items/${item.id}`, { priceCents: 1100, costCents: null, tags: ["Gold"] })).json();
    expect(edited).toMatchObject({ priceCents: 1100, costCents: null, tags: ["gold"], incomplete: true, name: "Ring" });

    const archived = (await call("PATCH", `/api/items/${item.id}`, { archived: true })).json();
    expect(archived.archived).toBe(true);
    expect((await call("GET", "/api/items")).json().total).toBe(0);
    expect((await call("GET", "/api/items?archived=only")).json().total).toBe(1);
    expect((await call("PATCH", `/api/items/${item.id}`, { archived: false })).json().archived).toBe(false);
    expect((await call("PATCH", "/api/items/999", { name: "x" })).statusCode).toBe(404);
  });

  it("uncategorises items when their category is deleted", async () => {
    const { call, cat } = await withCategory();
    const item = (await call("POST", "/api/items", { name: "Bag", categoryId: cat.id })).json();
    expect((await call("DELETE", `/api/categories/${cat.id}`)).statusCode).toBe(204);
    expect((await call("GET", `/api/items/${item.id}`)).json()).toMatchObject({ categoryId: null, categoryName: null });
  });
});

describe("item search and filters", () => {
  async function seeded() {
    const ctx = await withCategory("Jewelry");
    const mk = (body: object) => ctx.call("POST", "/api/items", body).then((r) => r.json());
    const ring = await mk({ name: "Gold ring", categoryId: ctx.cat.id, priceCents: 5000, tags: ["gold"] });
    const scarf = await mk({ name: "Wool scarf", description: "chunky knit", priceCents: 3000 });
    const pct = await mk({ name: "50% off sign", priceCents: 100 });
    for (let i = 0; i < 9; i++) await mk({ name: `Filler ${i}` });
    const n42 = await mk({ name: "Number thirteen" }); // id 13
    return { ...ctx, ring, scarf, pct, n42 };
  }
  const ids = (res: { json(): { items: { id: number }[] } }) => res.json().items.map((i) => i.id);

  it("finds by item number ignoring leading zeros and #", async () => {
    const { call, n42 } = await seeded();
    for (const q of ["13", "0013", "%2313"]) expect(ids(await call("GET", `/api/items?q=${q}`))).toEqual([n42.id]);
  });

  it("matches every word across name, description, tags and category", async () => {
    const { call, ring, scarf } = await seeded();
    expect(ids(await call("GET", "/api/items?q=chunky"))).toEqual([scarf.id]);
    expect(ids(await call("GET", "/api/items?q=jewelry%20gold"))).toEqual([ring.id]);
    expect(ids(await call("GET", "/api/items?q=gold%20wool"))).toEqual([]);
  });

  it("treats LIKE wildcards literally", async () => {
    const { call, pct } = await seeded();
    expect(ids(await call("GET", "/api/items?q=%25"))).toEqual([pct.id]);
  });

  it("filters by category and sorts by price", async () => {
    const { call, ring, scarf, pct } = await seeded();
    expect(ids(await call("GET", `/api/items?categoryId=${ring.categoryId}`))).toEqual([ring.id]);
    expect(ids(await call("GET", "/api/items?categoryId=none")).includes(ring.id)).toBe(false);
    const byPrice = ids(await call("GET", "/api/items?sort=price_desc&limit=3"));
    expect(byPrice).toEqual([ring.id, scarf.id, pct.id]);
  });

  it("filters by status and paginates with a total", async () => {
    const { call } = await seeded();
    expect((await call("GET", "/api/items?status=sold")).json().total).toBe(0);
    const page = (await call("GET", "/api/items?status=in_studio&limit=5&offset=5")).json();
    expect(page.total).toBe(13);
    expect(page.items).toHaveLength(5);
  });
});

describe("normalizeTags", () => {
  it("trims, lowercases, collapses spaces and dedupes", () => {
    expect(normalizeTags([" Silk ", "silk", "Hand  Made", ""])).toEqual(["silk", "hand made"]);
  });
});
