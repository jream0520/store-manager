import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { idParams } from "./categories.js";
import { getItem, type Item, type Status } from "./items.js";
import { isValidDay } from "./status.js";

// Selling (F15), the shop's periodic reports and reconciling against them (F16–F18), profit (F21).

export const SELLABLE: readonly Status[] = ["in_shop", "in_studio"];

export interface Sale {
  id: number;
  itemId: number;
  itemNumber: number;
  itemName: string;
  coverPhotoId: string | null;
  saleDate: string;
  soldCents: number;
  /** Retail price when sold. */
  retailCents: number | null;
  /** The item's current materials cost; null until entered. */
  costCents: number | null;
  profitCents: number | null;
  reportId: number | null;
  note: string;
  /** F18: sold for a different amount than the retail price, or sold while not in the shop. */
  priceDiffers: boolean;
  notInShop: boolean;
  createdAt: string;
}

interface SaleRow {
  id: number;
  item_id: number;
  item_name: string;
  cover_photo_id: string | null;
  sale_date: string;
  sold_cents: number;
  retail_cents: number | null;
  cost_cents: number | null;
  previous_status: Status;
  report_id: number | null;
  note: string;
  created_at: string;
}

const SALE_SELECT = `SELECT s.*, i.name AS item_name, i.cost_cents,
  (SELECT p.id FROM photos p WHERE p.item_id = i.id ORDER BY p.sort_order, p.created_at LIMIT 1) AS cover_photo_id
  FROM sales s JOIN items i ON i.id = s.item_id`;

function toSale(r: SaleRow): Sale {
  return {
    id: r.id,
    itemId: r.item_id,
    itemNumber: r.item_id,
    itemName: r.item_name,
    coverPhotoId: r.cover_photo_id,
    saleDate: r.sale_date,
    soldCents: r.sold_cents,
    retailCents: r.retail_cents,
    costCents: r.cost_cents,
    profitCents: r.cost_cents === null ? null : r.sold_cents - r.cost_cents,
    reportId: r.report_id,
    note: r.note,
    priceDiffers: r.retail_cents !== null && r.retail_cents !== r.sold_cents,
    notInShop: r.previous_status !== "in_shop",
    createdAt: r.created_at,
  };
}

export function getSale(db: Database.Database, id: number): Sale | undefined {
  const r = db.prepare(`${SALE_SELECT} WHERE s.id = ?`).get(id) as SaleRow | undefined;
  return r && toSale(r);
}

function saleForItem(db: Database.Database, itemId: number): Sale | undefined {
  const r = db.prepare(`${SALE_SELECT} WHERE s.item_id = ?`).get(itemId) as SaleRow | undefined;
  return r && toSale(r);
}

export interface SaleInput {
  itemId: number;
  saleDate: string;
  soldCents?: number;
  reportId?: number | null;
  note?: string;
  /** Required to sell an item that isn't recorded as in the shop (F18). */
  allowNotInShop?: boolean;
}

export type SellResult =
  | { ok: true; sale: Sale; item: Item }
  | { ok: false; code: "not_found" | "report_not_found" }
  | { ok: false; code: "duplicate"; sale: Sale }
  | { ok: false; code: "not_in_shop" | "not_sellable"; status: Status };

export function sell(db: Database.Database, input: SaleInput): SellResult {
  return db.transaction((): SellResult => {
    const item = db.prepare("SELECT id, status, price_cents FROM items WHERE id = ?").get(input.itemId) as
      | { id: number; status: Status; price_cents: number | null }
      | undefined;
    if (!item) return { ok: false, code: "not_found" };
    const existing = saleForItem(db, item.id);
    if (existing) return { ok: false, code: "duplicate", sale: existing };
    if (!SELLABLE.includes(item.status)) return { ok: false, code: "not_sellable", status: item.status };
    if (item.status !== "in_shop" && !input.allowNotInShop) return { ok: false, code: "not_in_shop", status: item.status };
    if (input.reportId && !db.prepare("SELECT 1 FROM shop_reports WHERE id = ?").get(input.reportId)) {
      return { ok: false, code: "report_not_found" };
    }

    const sold = input.soldCents ?? item.price_cents ?? 0;
    const r = db
      .prepare(
        `INSERT INTO sales (item_id, sale_date, sold_cents, retail_cents, previous_status, report_id, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(item.id, input.saleDate, sold, item.price_cents, item.status, input.reportId ?? null, input.note?.trim() ?? "");
    db.prepare("UPDATE items SET status = 'sold', updated_at = datetime('now') WHERE id = ?").run(item.id);
    if (item.status === "in_shop") {
      db.prepare("UPDATE placements SET removed_on = ? WHERE item_id = ? AND removed_on IS NULL").run(
        input.saleDate,
        item.id,
      );
    }
    logStatus(db, item.id, item.status, "sold", input.saleDate, input.note?.trim() ?? "");
    return { ok: true, sale: getSale(db, Number(r.lastInsertRowid))!, item: getItem(db, item.id)! };
  })();
}

/** Reverses a sale entered by mistake: the item goes back to where it was (F15). */
export function undoSale(db: Database.Database, saleId: number, today: string): Item | undefined {
  return db.transaction(() => {
    const s = db.prepare("SELECT * FROM sales WHERE id = ?").get(saleId) as SaleRow | undefined;
    if (!s) return undefined;
    db.prepare("DELETE FROM sales WHERE id = ?").run(saleId);
    db.prepare("UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?").run(s.previous_status, s.item_id);
    if (s.previous_status === "in_shop") {
      // Reopen the placement the sale closed, keeping its original date and location.
      db.prepare(
        `UPDATE placements SET removed_on = NULL
         WHERE id = (SELECT id FROM placements WHERE item_id = ? ORDER BY id DESC LIMIT 1)`,
      ).run(s.item_id);
    }
    logStatus(db, s.item_id, "sold", s.previous_status, today, "sale undone");
    return getItem(db, s.item_id);
  })();
}

function logStatus(db: Database.Database, itemId: number, from: Status, to: Status, on: string, note: string) {
  db.prepare(
    "INSERT INTO item_events (item_id, kind, from_status, to_status, happened_on, note) VALUES (?, 'status', ?, ?, ?, ?)",
  ).run(itemId, from, to, on, note);
}

// ---- reports ----

export interface ShopReport {
  id: number;
  periodStart: string;
  periodEnd: string;
  receivedOn: string | null;
  reportedCount: number | null;
  reportedTotalCents: number | null;
  note: string;
  reconciled: boolean;
  /** What's been entered against this report so far. */
  enteredCount: number;
  enteredTotalCents: number;
  createdAt: string;
}

interface ReportRow {
  id: number;
  period_start: string;
  period_end: string;
  received_on: string | null;
  reported_count: number | null;
  reported_total_cents: number | null;
  note: string;
  reconciled_at: string | null;
  created_at: string;
  entered_count: number;
  entered_total: number;
}

const REPORT_SELECT = `SELECT r.*,
  (SELECT COUNT(*) FROM sales s WHERE s.report_id = r.id) AS entered_count,
  (SELECT COALESCE(SUM(s.sold_cents), 0) FROM sales s WHERE s.report_id = r.id) AS entered_total
  FROM shop_reports r`;

function toReport(r: ReportRow): ShopReport {
  return {
    id: r.id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    receivedOn: r.received_on,
    reportedCount: r.reported_count,
    reportedTotalCents: r.reported_total_cents,
    note: r.note,
    reconciled: r.reconciled_at !== null,
    enteredCount: r.entered_count,
    enteredTotalCents: r.entered_total,
    createdAt: r.created_at,
  };
}

export function getReport(db: Database.Database, id: number): ShopReport | undefined {
  const r = db.prepare(`${REPORT_SELECT} WHERE r.id = ?`).get(id) as ReportRow | undefined;
  return r && toReport(r);
}

// ---- routes ----

const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const money = { type: "integer", minimum: 0, maximum: 100_000_000 } as const;
const reportProps = {
  periodStart: day,
  periodEnd: day,
  receivedOn: { anyOf: [day, { type: "null" }] },
  reportedCount: { type: ["integer", "null"], minimum: 0, maximum: 100_000 },
  reportedTotalCents: { anyOf: [money, { type: "null" }] },
  note: { type: "string", maxLength: 1000 },
} as const;

type ReportInput = {
  periodStart?: string;
  periodEnd?: string;
  receivedOn?: string | null;
  reportedCount?: number | null;
  reportedTotalCents?: number | null;
  note?: string;
  reconciled?: boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

export function salesRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: SaleInput }>(
      "/api/sales",
      {
        schema: {
          body: {
            type: "object",
            required: ["itemId", "saleDate"],
            additionalProperties: false,
            properties: {
              itemId: { type: "integer", minimum: 1 },
              saleDate: day,
              soldCents: money,
              reportId: { type: ["integer", "null"], minimum: 1 },
              note: { type: "string", maxLength: 500 },
              allowNotInShop: { type: "boolean" },
            },
          },
        },
      },
      async (req, reply) => {
        if (!isValidDay(req.body.saleDate)) return badDate(reply);
        const r = sell(db, req.body);
        if (r.ok) return reply.code(201).send({ sale: r.sale, item: r.item });
        switch (r.code) {
          case "not_found":
            return reply.code(404).send({ error: "no item with that number", code: r.code });
          case "report_not_found":
            return reply.code(400).send({ error: "unknown report", code: r.code });
          case "duplicate":
            return reply.code(409).send({ error: "that item is already sold", code: r.code, sale: r.sale });
          default:
            return reply.code(409).send({
              error: r.code === "not_in_shop" ? "that item isn't recorded as in the shop" : "that item can't be sold",
              code: r.code,
              status: r.status,
            });
        }
      },
    );

    app.patch<{ Params: { id: number }; Body: { saleDate?: string; soldCents?: number; note?: string; reportId?: number | null } }>(
      "/api/sales/:id",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              saleDate: day,
              soldCents: money,
              note: { type: "string", maxLength: 500 },
              reportId: { type: ["integer", "null"], minimum: 1 },
            },
          },
        },
      },
      async (req, reply) => {
        const b = req.body;
        if (b.saleDate !== undefined && !isValidDay(b.saleDate)) return badDate(reply);
        if (b.reportId && !getReport(db, b.reportId)) return reply.code(400).send({ error: "unknown report" });
        const sets: string[] = [];
        const params: (string | number | null)[] = [];
        if (b.saleDate !== undefined) (sets.push("sale_date = ?"), params.push(b.saleDate));
        if (b.soldCents !== undefined) (sets.push("sold_cents = ?"), params.push(b.soldCents));
        if (b.note !== undefined) (sets.push("note = ?"), params.push(b.note.trim()));
        if (b.reportId !== undefined) (sets.push("report_id = ?"), params.push(b.reportId));
        const r = db.prepare(`UPDATE sales SET ${sets.join(", ")} WHERE id = ?`).run(...params, req.params.id);
        if (!r.changes) return notFound(reply);
        return getSale(db, req.params.id);
      },
    );

    app.get<{ Params: { id: number } }>("/api/sales/:id", { schema: { params: idParams } }, async (req, reply) => {
      return getSale(db, req.params.id) ?? notFound(reply);
    });

    app.delete<{ Params: { id: number } }>("/api/sales/:id", { schema: { params: idParams } }, async (req, reply) => {
      const item = undoSale(db, req.params.id, today());
      return item ? { item } : notFound(reply);
    });

    app.get<{ Querystring: { from?: string; to?: string; reportId?: number } }>(
      "/api/sales",
      {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: { from: day, to: day, reportId: { type: "integer", minimum: 1 } },
          },
        },
      },
      async (req) => {
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (req.query.from) (where.push("s.sale_date >= ?"), params.push(req.query.from));
        if (req.query.to) (where.push("s.sale_date <= ?"), params.push(req.query.to));
        if (req.query.reportId) (where.push("s.report_id = ?"), params.push(req.query.reportId));
        const rows = db
          .prepare(`${SALE_SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY s.sale_date DESC, s.id DESC`)
          .all(...params) as SaleRow[];
        const sales = rows.map(toSale);
        const withCost = sales.filter((s) => s.profitCents !== null);
        return {
          sales,
          count: sales.length,
          totalCents: sales.reduce((n, s) => n + s.soldCents, 0),
          profitCents: withCost.reduce((n, s) => n + s.profitCents!, 0),
          missingCostCount: sales.length - withCost.length,
        };
      },
    );

    // ---- reports ----

    app.get("/api/reports", async () =>
      (db.prepare(`${REPORT_SELECT} ORDER BY r.period_end DESC, r.id DESC`).all() as ReportRow[]).map(toReport),
    );

    app.post<{ Body: ReportInput }>(
      "/api/reports",
      {
        schema: {
          body: { type: "object", required: ["periodStart", "periodEnd"], additionalProperties: false, properties: reportProps },
        },
      },
      async (req, reply) => {
        const b = req.body;
        const bad = checkReportDates(b.periodStart!, b.periodEnd!, b.receivedOn);
        if (bad) return reply.code(400).send({ error: bad });
        const r = db
          .prepare(
            `INSERT INTO shop_reports (period_start, period_end, received_on, reported_count, reported_total_cents, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(b.periodStart, b.periodEnd, b.receivedOn ?? null, b.reportedCount ?? null, b.reportedTotalCents ?? null, b.note?.trim() ?? "");
        return reply.code(201).send(getReport(db, Number(r.lastInsertRowid)));
      },
    );

    app.get<{ Params: { id: number } }>("/api/reports/:id", { schema: { params: idParams } }, async (req, reply) => {
      return getReport(db, req.params.id) ?? notFound(reply);
    });

    app.patch<{ Params: { id: number }; Body: ReportInput }>(
      "/api/reports/:id",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: { ...reportProps, reconciled: { type: "boolean" } },
          },
        },
      },
      async (req, reply) => {
        const current = getReport(db, req.params.id);
        if (!current) return notFound(reply);
        const b = req.body;
        const bad = checkReportDates(
          b.periodStart ?? current.periodStart,
          b.periodEnd ?? current.periodEnd,
          b.receivedOn === undefined ? current.receivedOn : b.receivedOn,
        );
        if (bad) return reply.code(400).send({ error: bad });
        const cols: Record<string, string> = {
          periodStart: "period_start",
          periodEnd: "period_end",
          receivedOn: "received_on",
          reportedCount: "reported_count",
          reportedTotalCents: "reported_total_cents",
          note: "note",
        };
        const sets: string[] = [];
        const params: (string | number | null)[] = [];
        for (const [k, col] of Object.entries(cols)) {
          const v = b[k as keyof ReportInput];
          if (v !== undefined) (sets.push(`${col} = ?`), params.push(typeof v === "string" ? v.trim() : (v as number | null)));
        }
        if (b.reconciled !== undefined) sets.push(`reconciled_at = ${b.reconciled ? "COALESCE(reconciled_at, datetime('now'))" : "NULL"}`);
        db.prepare(`UPDATE shop_reports SET ${sets.join(", ")} WHERE id = ?`).run(...params, req.params.id);
        return getReport(db, req.params.id);
      },
    );

    // Sales entered against it stay recorded; they just lose the link.
    app.delete<{ Params: { id: number } }>("/api/reports/:id", { schema: { params: idParams } }, async (req, reply) => {
      const r = db.prepare("DELETE FROM shop_reports WHERE id = ?").run(req.params.id);
      return r.changes ? reply.code(204).send() : notFound(reply);
    });
  };
}

function checkReportDates(start: string, end: string, received: string | null | undefined): string | undefined {
  if (!isValidDay(start) || !isValidDay(end)) return "period dates must be real dates, not in the future";
  if (end < start) return "the period can't end before it starts";
  if (received && !isValidDay(received)) return "received date must be a real date, not in the future";
  return undefined;
}

function badDate(reply: FastifyReply) {
  return reply.code(400).send({ error: "sale date must be a real date, not in the future" });
}

function notFound(reply: FastifyReply) {
  return reply.code(404).send({ error: "not found" });
}
