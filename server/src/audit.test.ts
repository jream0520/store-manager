import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "./auth.js";
import { CSRF, PASSWORD, signedIn } from "./testing.js";

const audit = async (call: Awaited<ReturnType<typeof signedIn>>["call"], q = "") =>
  (await call("GET", `/api/audit${q}`)).json();

describe("audit log", () => {
  it("records item creation, field-level edits, and nothing for no-op saves", async () => {
    const { call } = await signedIn();
    const item = (await call("POST", "/api/items", { name: "Scarf", number: 42, priceCents: 4800 })).json();
    await call("PATCH", `/api/items/${item.id}`, { priceCents: 4500, name: "Silk scarf" });
    await call("PATCH", `/api/items/${item.id}`, { priceCents: 4500 }); // unchanged: no entry

    const log = await audit(call, "?entity=items");
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      entity: "items",
      action: "update",
      item: { id: item.id, number: 42, name: "Silk scarf" },
    });
    expect(log[0].changes).toEqual([
      { field: "name", from: "Scarf", to: "Silk scarf" },
      { field: "price_cents", from: 4800, to: 4500 },
    ]);
    expect(log[1].action).toBe("create");
    expect(log[1].changes.map((c: { field: string }) => c.field)).toEqual(["number", "name", "tags", "price_cents", "status"]);
  });

  it("covers sales, expenses, settings and deletions, linking them to the item", async () => {
    const { call } = await signedIn();
    const item = (await call("POST", "/api/items", { name: "Hat", number: 9, priceCents: 3000 })).json();
    await call("POST", "/api/items/status", { ids: [item.id], action: "place" });
    const { sale } = (await call("POST", "/api/sales", { itemId: item.id, saleDate: "2026-10-05" })).json();
    await call("DELETE", `/api/sales/${sale.id}`);
    const exp = (await call("POST", "/api/expenses", { spentOn: "2026-10-01", category: "rent", amountCents: 100 })).json();
    await call("DELETE", `/api/expenses/${exp.id}`);
    await call("PATCH", "/api/settings", { shopName: "Boutique" });

    const log = await audit(call);
    const kinds = log.map((e: { entity: string; action: string }) => `${e.entity}:${e.action}`);
    expect(kinds).toContain("sales:create");
    expect(kinds).toContain("sales:delete");
    expect(kinds).toContain("expenses:delete");
    expect(kinds).toContain("settings:create");
    const saleEntry = log.find((e: { entity: string; action: string }) => e.entity === "sales" && e.action === "create");
    expect(saleEntry.item).toMatchObject({ number: 9, name: "Hat" });
  });

  it("records sign-ins, failures, password changes and sign-out-everywhere", async () => {
    const { call, app } = await signedIn();
    const login = (password: string) =>
      app.inject({ method: "POST", url: "/api/auth/login", headers: CSRF, payload: { password } });
    const cookieFrom = (res: { cookies: { name: string; value: string }[] }) => {
      const c = res.cookies.find((x) => x.name === SESSION_COOKIE)!;
      return { ...CSRF, cookie: `${SESSION_COOKIE}=${c.value}` };
    };

    await login("wrong password!");
    const changed = await call("POST", "/api/auth/password", { current: PASSWORD, next: "another good one" });
    const headers = cookieFrom(changed); // the change issues a fresh session
    await app.inject({ method: "POST", url: "/api/auth/logout-all", headers });
    expect((await app.inject({ url: "/api/items", headers })).statusCode).toBe(401); // really signed out

    const again = cookieFrom(await login("another good one"));
    const log = (await app.inject({ url: "/api/audit?entity=auth", headers: again })).json();
    expect(log.map((e: { action: string }) => e.action)).toEqual([
      "login",
      "signed_out_everywhere",
      "password_changed",
      "login_failed",
      "login",
    ]);
    expect(log[0].changes.map((c: { field: string }) => c.field)).toEqual(["ip", "userAgent"]);
  });

  it("pages backwards with `before`", async () => {
    const { call } = await signedIn();
    for (let i = 1; i <= 5; i++) await call("POST", "/api/categories", { name: `C${i}` });
    const first = await audit(call, "?entity=categories&limit=2");
    const next = await audit(call, `?entity=categories&limit=2&before=${first[1].id}`);
    expect([...first, ...next].map((e: { changes: { to: string }[] }) => e.changes[0].to)).toEqual(["C5", "C4", "C3", "C2"]);
  });
});
