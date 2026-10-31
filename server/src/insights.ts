import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./expenses.js";
import { isValidDay } from "./status.js";

// Dashboard (F23), profit and sales analysis (F24), aging (F25).
//
// Profit everywhere = sold price − the item's materials cost. Sales whose item has no cost
// yet count as zero cost and are reported in `missingCostCount`, so the UI can warn that
// profit may be overstated rather than silently leaving those sales out.

export interface Summary {
  salesCount: number;
  salesCents: number;
  materialsCents: number;
  profitCents: number;
  missingCostCount: number;
  expensesCents: number;
  expensesByCategory: Record<ExpenseCategory, number>;
  /** profit − expenses */
  netCents: number;
}

export function summarize(db: Database.Database, from: string, to: string): Summary {
  const s = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(s.sold_cents), 0) AS sales, COALESCE(SUM(i.cost_cents), 0) AS materials,
              SUM(i.cost_cents IS NULL) AS missing
       FROM sales s JOIN items i ON i.id = s.item_id WHERE s.sale_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { n: number; sales: number; materials: number; missing: number | null };
  const byCat = Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c, 0])) as Record<ExpenseCategory, number>;
  for (const r of db
    .prepare("SELECT category, SUM(amount_cents) AS total FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY category")
    .all(from, to) as { category: ExpenseCategory; total: number }[]) {
    byCat[r.category] = r.total;
  }
  const expenses = Object.values(byCat).reduce((a, b) => a + b, 0);
  const profit = s.sales - s.materials;
  return {
    salesCount: s.n,
    salesCents: s.sales,
    materialsCents: s.materials,
    profitCents: profit,
    missingCostCount: s.missing ?? 0,
    expensesCents: expenses,
    expensesByCategory: byCat,
    netCents: profit - expenses,
  };
}

const AGING_DAYS = [60, 90] as const;

export function dashboard(db: Database.Database, today: string) {
  const counts = Object.fromEntries(
    (
      db.prepare("SELECT status, COUNT(*) AS n FROM items WHERE archived_at IS NULL GROUP BY status").all() as {
        status: string;
        n: number;
      }[]
    ).map((r) => [r.status, r.n]),
  );
  const incomplete = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM items WHERE archived_at IS NULL AND status IN ('in_studio', 'in_shop')
         AND (price_cents IS NULL OR cost_cents IS NULL OR category_id IS NULL)`,
      )
      .get() as { n: number }
  ).n;
  const shop = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(i.price_cents), 0) AS value,
              ${AGING_DAYS.map((d) => `SUM(julianday(?) - julianday(pl.placed_on) >= ${d}) AS over${d}`).join(", ")}
       FROM items i JOIN placements pl ON pl.item_id = i.id AND pl.removed_on IS NULL
       WHERE i.status = 'in_shop'`,
    )
    .get(...AGING_DAYS.map(() => today)) as { n: number; value: number; over60: number | null; over90: number | null };

  const recent = (
    db
      .prepare(
        `SELECT e.kind, e.from_status, e.to_status, e.happened_on, e.old_cents, e.new_cents, e.created_at,
                i.id AS item_id, i.number, i.name
         FROM item_events e JOIN items i ON i.id = e.item_id ORDER BY e.id DESC LIMIT 10`,
      )
      .all() as {
      kind: "status" | "price";
      from_status: string | null;
      to_status: string | null;
      happened_on: string | null;
      old_cents: number | null;
      new_cents: number | null;
      created_at: string;
      item_id: number;
      number: number;
      name: string;
    }[]
  ).map((r) => ({
    kind: r.kind,
    from: r.from_status,
    to: r.to_status,
    on: r.happened_on ?? r.created_at.slice(0, 10),
    oldCents: r.old_cents,
    newCents: r.new_cents,
    itemId: r.item_id,
    itemNumber: r.number,
    itemName: r.name,
  }));

  return {
    counts: {
      inStudio: counts.in_studio ?? 0,
      inShop: counts.in_shop ?? 0,
      sold: counts.sold ?? 0,
      writtenOff: counts.written_off ?? 0,
      incomplete,
    },
    shop: { count: shop.n, valueCents: shop.value, over60Days: shop.over60 ?? 0, over90Days: shop.over90 ?? 0 },
    month: summarize(db, `${today.slice(0, 7)}-01`, today),
    year: summarize(db, `${today.slice(0, 4)}-01-01`, today),
    recent,
  };
}

export function analysis(db: Database.Database, from: string, to: string) {
  const byCategory = db
    .prepare(
      `SELECT COALESCE(c.name, 'Uncategorized') AS category, COUNT(*) AS count,
              SUM(s.sold_cents) AS salesCents, SUM(s.sold_cents - COALESCE(i.cost_cents, 0)) AS profitCents,
              AVG(julianday(s.sale_date) - julianday(
                (SELECT MIN(pl.placed_on) FROM placements pl WHERE pl.item_id = i.id))) AS avgDaysToSell
       FROM sales s JOIN items i ON i.id = s.item_id LEFT JOIN categories c ON c.id = i.category_id
       WHERE s.sale_date BETWEEN ? AND ?
       GROUP BY c.id ORDER BY salesCents DESC`,
    )
    .all(from, to) as { category: string; count: number; salesCents: number; profitCents: number; avgDaysToSell: number | null }[];

  const topItems = db
    .prepare(
      `SELECT i.id AS itemId, i.number AS itemNumber, i.name AS itemName, s.sale_date AS saleDate, s.sold_cents AS soldCents,
              CASE WHEN i.cost_cents IS NULL THEN NULL ELSE s.sold_cents - i.cost_cents END AS profitCents
       FROM sales s JOIN items i ON i.id = s.item_id
       WHERE s.sale_date BETWEEN ? AND ?
       ORDER BY s.sold_cents DESC, s.sale_date DESC LIMIT 10`,
    )
    .all(from, to);

  // Days from first placement in the shop to sale; items sold without ever being placed are skipped.
  const days = db
    .prepare(
      `SELECT AVG(julianday(s.sale_date) - julianday(first.placed_on)) AS avg, COUNT(first.placed_on) AS n
       FROM sales s JOIN (SELECT item_id, MIN(placed_on) AS placed_on FROM placements GROUP BY item_id) first
         ON first.item_id = s.item_id
       WHERE s.sale_date BETWEEN ? AND ?`,
    )
    .get(from, to) as { avg: number | null; n: number };

  const byMonth = db
    .prepare(
      `WITH months AS (
         SELECT substr(s.sale_date, 1, 7) AS month, SUM(s.sold_cents) AS sales,
                SUM(s.sold_cents - COALESCE(i.cost_cents, 0)) AS profit, 0 AS expenses
         FROM sales s JOIN items i ON i.id = s.item_id WHERE s.sale_date BETWEEN ? AND ? GROUP BY 1
         UNION ALL
         SELECT substr(spent_on, 1, 7), 0, 0, SUM(amount_cents) FROM expenses WHERE spent_on BETWEEN ? AND ? GROUP BY 1
       )
       SELECT month, SUM(sales) AS salesCents, SUM(profit) AS profitCents, SUM(expenses) AS expensesCents,
              SUM(profit) - SUM(expenses) AS netCents
       FROM months GROUP BY month ORDER BY month`,
    )
    .all(from, to, from, to);

  return {
    from,
    to,
    summary: summarize(db, from, to),
    byCategory: byCategory.map((c) => ({ ...c, avgDaysToSell: c.avgDaysToSell === null ? null : Math.round(c.avgDaysToSell) })),
    topItems,
    avgDaysToSell: days.avg === null ? null : Math.round(days.avg),
    daysToSellSampleSize: days.n,
    byMonth,
  };
}

const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;

export function insightRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    // `today` comes from the device so "this month" matches the owner's calendar, not UTC.
    app.get<{ Querystring: { today?: string } }>(
      "/api/dashboard",
      { schema: { querystring: { type: "object", additionalProperties: false, properties: { today: day } } } },
      async (req, reply) => {
        const today = req.query.today ?? new Date().toISOString().slice(0, 10);
        if (!isValidDay(today)) return bad(reply);
        return dashboard(db, today);
      },
    );

    app.get<{ Querystring: { from: string; to: string } }>(
      "/api/analysis",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["from", "to"],
            additionalProperties: false,
            properties: { from: day, to: day },
          },
        },
      },
      async (req, reply) => {
        const { from, to } = req.query;
        if (!isValidDay(from) || !isValidDay(to) || to < from) return bad(reply);
        return analysis(db, from, to);
      },
    );
  };
}

function bad(reply: FastifyReply) {
  return reply.code(400).send({ error: "dates must be real, not in the future, and in order" });
}
