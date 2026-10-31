import type { FastifyInstance, FastifyReply } from "fastify";
import type Database from "better-sqlite3";
import { idParams } from "./categories.js";
import { isValidDay } from "./status.js";

export const EXPENSE_CATEGORIES = ["rent", "fees", "supplies", "marketing", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface Expense {
  id: number;
  spentOn: string;
  category: ExpenseCategory;
  amountCents: number;
  note: string;
  createdAt: string;
}

interface ExpenseRow {
  id: number;
  spent_on: string;
  category: ExpenseCategory;
  amount_cents: number;
  note: string;
  created_at: string;
}

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  spentOn: r.spent_on,
  category: r.category,
  amountCents: r.amount_cents,
  note: r.note,
  createdAt: r.created_at,
});

export function listExpenses(db: Database.Database, from?: string, to?: string): Expense[] {
  const where: string[] = [];
  const params: string[] = [];
  if (from) (where.push("spent_on >= ?"), params.push(from));
  if (to) (where.push("spent_on <= ?"), params.push(to));
  const rows = db
    .prepare(`SELECT * FROM expenses ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY spent_on DESC, id DESC`)
    .all(...params) as ExpenseRow[];
  return rows.map(toExpense);
}

const day = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" } as const;
const props = {
  spentOn: day,
  category: { type: "string", enum: EXPENSE_CATEGORIES },
  amountCents: { type: "integer", minimum: 1, maximum: 100_000_000 },
  note: { type: "string", maxLength: 500 },
} as const;

type Input = { spentOn?: string; category?: ExpenseCategory; amountCents?: number; note?: string };

export function expenseRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { from?: string; to?: string } }>(
      "/api/expenses",
      { schema: { querystring: { type: "object", additionalProperties: false, properties: { from: day, to: day } } } },
      async (req) => listExpenses(db, req.query.from, req.query.to),
    );

    app.post<{ Body: Required<Pick<Input, "spentOn" | "category" | "amountCents">> & Input }>(
      "/api/expenses",
      {
        schema: {
          body: { type: "object", required: ["spentOn", "category", "amountCents"], additionalProperties: false, properties: props },
        },
      },
      async (req, reply) => {
        if (!isValidDay(req.body.spentOn)) return badDate(reply);
        const b = req.body;
        const r = db
          .prepare("INSERT INTO expenses (spent_on, category, amount_cents, note) VALUES (?, ?, ?, ?)")
          .run(b.spentOn, b.category, b.amountCents, b.note?.trim() ?? "");
        return reply.code(201).send(get(db, Number(r.lastInsertRowid)));
      },
    );

    app.patch<{ Params: { id: number }; Body: Input }>(
      "/api/expenses/:id",
      { schema: { params: idParams, body: { type: "object", additionalProperties: false, minProperties: 1, properties: props } } },
      async (req, reply) => {
        const b = req.body;
        if (b.spentOn !== undefined && !isValidDay(b.spentOn)) return badDate(reply);
        const cols = { spentOn: "spent_on", category: "category", amountCents: "amount_cents", note: "note" } as const;
        const sets: string[] = [];
        const params: (string | number)[] = [];
        for (const [k, col] of Object.entries(cols)) {
          const v = b[k as keyof Input];
          if (v !== undefined) (sets.push(`${col} = ?`), params.push(typeof v === "string" ? v.trim() : v));
        }
        const r = db.prepare(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ?`).run(...params, req.params.id);
        return r.changes ? get(db, req.params.id) : reply.code(404).send({ error: "not found" });
      },
    );

    app.delete<{ Params: { id: number } }>("/api/expenses/:id", { schema: { params: idParams } }, async (req, reply) => {
      const r = db.prepare("DELETE FROM expenses WHERE id = ?").run(req.params.id);
      return r.changes ? reply.code(204).send() : reply.code(404).send({ error: "not found" });
    });
  };
}

function get(db: Database.Database, id: number): Expense {
  return toExpense(db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as ExpenseRow);
}

function badDate(reply: FastifyReply) {
  return reply.code(400).send({ error: "date must be a real date, not in the future" });
}
