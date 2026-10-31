import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";

// CSV downloads of the owner's data (F26). Amounts are plain decimals ("12.50") so they open
// as numbers in Excel, Numbers and Google Sheets; a UTF-8 BOM keeps Excel from mangling accents.

type Cell = string | number | null | undefined;

export function toCsv(header: string[], rows: Cell[][]): string {
  const esc = (v: Cell) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralize spreadsheet formula injection from free-text fields.
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

const dollars = (c: number | null) => (c === null ? null : (c / 100).toFixed(2));

export function exportRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    const send = (reply: FastifyReply, name: string, body: string) =>
      reply
        .type("text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="store-manager-${name}-${new Date().toISOString().slice(0, 10)}.csv"`)
        .header("cache-control", "no-store")
        .send(body);

    app.get("/api/export/items.csv", async (_req, reply) => {
      const rows = db
        .prepare(
          `SELECT i.number, i.name, c.name AS category, i.status, i.price_cents, i.cost_cents, pl.placed_on, pl.location,
                  s.sale_date, s.sold_cents, i.tags, i.description, i.notes, i.archived_at, i.created_at
           FROM items i LEFT JOIN categories c ON c.id = i.category_id
           LEFT JOIN placements pl ON pl.item_id = i.id AND pl.removed_on IS NULL
           LEFT JOIN sales s ON s.item_id = i.id
           ORDER BY i.number`,
        )
        .all() as Record<string, string | number | null>[];
      const csv = toCsv(
        ["Number", "Name", "Category", "Status", "Price", "Materials cost", "In shop since", "Location",
          "Sale date", "Sold for", "Tags", "Description", "Notes", "Archived", "Created"],
        rows.map((r) => [
          r.number, r.name, r.category, r.status, dollars(r.price_cents as number | null),
          dollars(r.cost_cents as number | null), r.placed_on, r.location, r.sale_date,
          dollars(r.sold_cents as number | null), (JSON.parse(r.tags as string) as string[]).join("; "),
          r.description, r.notes, r.archived_at ? "yes" : "", r.created_at,
        ]),
      );
      return send(reply, "items", csv);
    });

    app.get("/api/export/sales.csv", async (_req, reply) => {
      const rows = db
        .prepare(
          `SELECT s.sale_date, i.number, i.name, c.name AS category, s.sold_cents, s.retail_cents, i.cost_cents,
                  r.period_start, r.period_end, s.note
           FROM sales s JOIN items i ON i.id = s.item_id LEFT JOIN categories c ON c.id = i.category_id
           LEFT JOIN shop_reports r ON r.id = s.report_id
           ORDER BY s.sale_date, i.number`,
        )
        .all() as Record<string, string | number | null>[];
      const csv = toCsv(
        ["Sale date", "Number", "Name", "Category", "Sold for", "Retail price", "Materials cost", "Profit", "Report period", "Note"],
        rows.map((r) => [
          r.sale_date, r.number, r.name, r.category, dollars(r.sold_cents as number),
          dollars(r.retail_cents as number | null), dollars(r.cost_cents as number | null),
          r.cost_cents === null ? null : dollars((r.sold_cents as number) - (r.cost_cents as number)),
          r.period_start ? `${r.period_start} to ${r.period_end}` : "", r.note,
        ]),
      );
      return send(reply, "sales", csv);
    });

    app.get("/api/export/expenses.csv", async (_req, reply) => {
      const rows = db.prepare("SELECT spent_on, category, amount_cents, note FROM expenses ORDER BY spent_on, id").all() as {
        spent_on: string;
        category: string;
        amount_cents: number;
        note: string;
      }[];
      const csv = toCsv(
        ["Date", "Category", "Amount", "Note"],
        rows.map((r) => [r.spent_on, r.category, dollars(r.amount_cents), r.note]),
      );
      return send(reply, "expenses", csv);
    });
  };
}
