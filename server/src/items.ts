import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { idParams } from "./categories.js";

export const STATUSES = ["in_studio", "in_shop", "sold", "returned", "written_off"] as const;
export type Status = (typeof STATUSES)[number];

export interface Item {
  id: number;
  /** The hand-written tag number. Same as id; ids are never reused. */
  number: number;
  name: string;
  description: string;
  categoryId: number | null;
  categoryName: string | null;
  /** First photo by sort order; its thumbnail is shown in lists (M3). */
  coverPhotoId: string | null;
  photoCount: number;
  tags: string[];
  costCents: number | null;
  priceCents: number | null;
  status: Status;
  /** Current shop placement (M4), when status is in_shop. */
  placedOn: string | null;
  location: string | null;
  notes: string;
  archived: boolean;
  /** Missing price, cost or category: typically created via quick-add (F7). */
  incomplete: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ItemRow {
  id: number;
  name: string;
  description: string;
  category_id: number | null;
  category_name: string | null;
  cover_photo_id: string | null;
  photo_count: number;
  tags: string;
  cost_cents: number | null;
  price_cents: number | null;
  status: Status;
  placed_on: string | null;
  location: string | null;
  notes: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ItemInput {
  name?: string;
  description?: string;
  categoryId?: number | null;
  tags?: string[];
  costCents?: number | null;
  priceCents?: number | null;
  notes?: string;
  archived?: boolean;
}

export interface ListQuery {
  q?: string;
  status?: string;
  categoryId?: string;
  incomplete?: boolean;
  archived?: "exclude" | "only" | "include";
  sort?: keyof typeof SORTS;
  limit?: number;
  offset?: number;
}

const SORTS = {
  newest: "i.id DESC",
  oldest: "i.id ASC",
  name: "i.name COLLATE NOCASE ASC, i.id DESC",
  price_asc: "i.price_cents IS NULL, i.price_cents ASC, i.id DESC",
  price_desc: "i.price_cents IS NULL, i.price_cents DESC, i.id DESC",
  placed: "pl.placed_on IS NULL, pl.placed_on ASC, i.id ASC",
} as const;

const COLUMNS = `i.*, c.name AS category_name,
  (SELECT p.id FROM photos p WHERE p.item_id = i.id ORDER BY p.sort_order, p.created_at LIMIT 1) AS cover_photo_id,
  (SELECT COUNT(*) FROM photos p WHERE p.item_id = i.id) AS photo_count,
  pl.placed_on, pl.location`;
const JOINS = `LEFT JOIN categories c ON c.id = i.category_id
  LEFT JOIN placements pl ON pl.item_id = i.id AND pl.removed_on IS NULL`;
const SELECT = `SELECT ${COLUMNS} FROM items i ${JOINS}`;
const INCOMPLETE_SQL = "(i.price_cents IS NULL OR i.cost_cents IS NULL OR i.category_id IS NULL)";

function toItem(r: ItemRow): Item {
  return {
    id: r.id,
    number: r.id,
    name: r.name,
    description: r.description,
    categoryId: r.category_id,
    categoryName: r.category_name,
    coverPhotoId: r.cover_photo_id,
    photoCount: r.photo_count,
    tags: JSON.parse(r.tags),
    costCents: r.cost_cents,
    priceCents: r.price_cents,
    status: r.status,
    placedOn: r.placed_on,
    location: r.location,
    notes: r.notes,
    archived: r.archived_at !== null,
    incomplete: r.price_cents === null || r.cost_cents === null || r.category_id === null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const tag = t.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

export function getItem(db: Database.Database, id: number): Item | undefined {
  const row = db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as ItemRow | undefined;
  return row && toItem(row);
}

export function listItems(
  db: Database.Database,
  q: ListQuery,
): { items: Item[]; total: number; totalPriceCents: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];

  const archived = q.archived ?? "exclude";
  if (archived === "exclude") where.push("i.archived_at IS NULL");
  if (archived === "only") where.push("i.archived_at IS NOT NULL");

  if (q.status) {
    const wanted = q.status.split(",").filter((s): s is Status => (STATUSES as readonly string[]).includes(s));
    if (wanted.length) {
      where.push(`i.status IN (${wanted.map(() => "?").join(",")})`);
      params.push(...wanted);
    }
  }

  if (q.categoryId === "none") where.push("i.category_id IS NULL");
  else if (q.categoryId && /^\d+$/.test(q.categoryId)) {
    where.push("i.category_id = ?");
    params.push(Number(q.categoryId));
  }

  if (q.incomplete) where.push(INCOMPLETE_SQL);

  const text = q.q?.trim();
  if (text) {
    // "42", "0042" and "#42" find item number 42 (leading zeros ignored, F2), plus any text matches.
    const asNumber = /^#?\d+$/.test(text) ? Number(text.replace("#", "")) : undefined;
    const tokenClauses = text.split(/\s+/).map((tok) => {
      const like = `%${tok.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like, like, like, like);
      return `(i.name LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.tags LIKE ? ESCAPE '\\'
               OR i.notes LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')`;
    });
    const textMatch = tokenClauses.join(" AND ");
    if (asNumber !== undefined) {
      where.push(`(i.id = ? OR (${textMatch}))`);
      params.splice(params.length - tokenClauses.length * 5, 0, asNumber);
    } else {
      where.push(`(${textMatch})`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const from = `FROM items i ${JOINS} ${whereSql}`;
  // Totals cover every match, not just this page (e.g. retail value of everything in the shop).
  const totals = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(i.price_cents), 0) AS v ${from}`).get(...params) as {
    n: number;
    v: number;
  };
  const order = SORTS[q.sort ?? "newest"] ?? SORTS.newest;
  const rows = db
    .prepare(`SELECT ${COLUMNS} ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, q.limit ?? 100, q.offset ?? 0) as ItemRow[];
  return { items: rows.map(toItem), total: totals.n, totalPriceCents: totals.v };
}

export function createItem(db: Database.Database, input: ItemInput & { name: string }): Item {
  const r = db
    .prepare(
      `INSERT INTO items (name, description, category_id, tags, cost_cents, price_cents, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.name.trim(),
      input.description?.trim() ?? "",
      input.categoryId ?? null,
      JSON.stringify(normalizeTags(input.tags ?? [])),
      input.costCents ?? null,
      input.priceCents ?? null,
      input.notes?.trim() ?? "",
    );
  return getItem(db, Number(r.lastInsertRowid))!;
}

export function updateItem(db: Database.Database, id: number, input: ItemInput): Item | undefined {
  return db.transaction(() => {
    if (input.priceCents !== undefined) recordPriceChange(db, id, input.priceCents);
    return applyUpdate(db, id, input);
  })();
}

/** Logs a price change (F5) when the new price differs from the stored one. */
function recordPriceChange(db: Database.Database, id: number, next: number | null) {
  const row = db.prepare("SELECT price_cents FROM items WHERE id = ?").get(id) as { price_cents: number | null } | undefined;
  if (!row || row.price_cents === next) return;
  db.prepare("INSERT INTO item_events (item_id, kind, old_cents, new_cents) VALUES (?, 'price', ?, ?)").run(
    id,
    row.price_cents,
    next,
  );
}

function applyUpdate(db: Database.Database, id: number, input: ItemInput): Item | undefined {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    params.push(v);
  };
  if (input.name !== undefined) set("name", input.name.trim());
  if (input.description !== undefined) set("description", input.description.trim());
  if (input.categoryId !== undefined) set("category_id", input.categoryId);
  if (input.tags !== undefined) set("tags", JSON.stringify(normalizeTags(input.tags)));
  if (input.costCents !== undefined) set("cost_cents", input.costCents);
  if (input.priceCents !== undefined) set("price_cents", input.priceCents);
  if (input.notes !== undefined) set("notes", input.notes.trim());
  if (input.archived !== undefined) sets.push(`archived_at = ${input.archived ? "COALESCE(archived_at, datetime('now'))" : "NULL"}`);
  if (!sets.length) return getItem(db, id);
  sets.push("updated_at = datetime('now')");
  const r = db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  return r.changes ? getItem(db, id) : undefined;
}

// ---- routes ----

const money = { type: ["integer", "null"], minimum: 0, maximum: 100_000_000 } as const;
const itemProps = {
  name: { type: "string", minLength: 1, maxLength: 120, pattern: "\\S" },
  description: { type: "string", maxLength: 4000 },
  categoryId: { type: ["integer", "null"], minimum: 1 },
  tags: { type: "array", maxItems: 20, items: { type: "string", maxLength: 30 } },
  costCents: money,
  priceCents: money,
  notes: { type: "string", maxLength: 4000 },
} as const;

export function itemRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: ListQuery }>(
      "/api/items",
      {
        schema: {
          querystring: {
            type: "object",
            properties: {
              q: { type: "string", maxLength: 200 },
              status: { type: "string", maxLength: 200 },
              categoryId: { type: "string", pattern: "^(none|\\d+)$" },
              incomplete: { type: "boolean" },
              archived: { type: "string", enum: ["exclude", "only", "include"] },
              sort: { type: "string", enum: Object.keys(SORTS) },
              limit: { type: "integer", minimum: 1, maximum: 500 },
              offset: { type: "integer", minimum: 0 },
            },
          },
        },
      },
      async (req) => listItems(db, req.query),
    );

    app.get<{ Params: { id: number } }>("/api/items/:id", { schema: { params: idParams } }, async (req, reply) => {
      return getItem(db, req.params.id) ?? reply.code(404).send({ error: "not found" });
    });

    app.post<{ Body: ItemInput & { name: string } }>(
      "/api/items",
      { schema: { body: { type: "object", required: ["name"], additionalProperties: false, properties: itemProps } } },
      async (req, reply) => {
        try {
          return reply.code(201).send(createItem(db, req.body));
        } catch (e) {
          if (isForeignKey(e)) return reply.code(400).send({ error: "unknown category" });
          throw e;
        }
      },
    );

    app.patch<{ Params: { id: number }; Body: ItemInput }>(
      "/api/items/:id",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            additionalProperties: false,
            properties: { ...itemProps, archived: { type: "boolean" } },
          },
        },
      },
      async (req, reply) => {
        try {
          return updateItem(db, req.params.id, req.body) ?? reply.code(404).send({ error: "not found" });
        } catch (e) {
          if (isForeignKey(e)) return reply.code(400).send({ error: "unknown category" });
          throw e;
        }
      },
    );
  };
}

function isForeignKey(e: unknown): boolean {
  return (e as { code?: string }).code === "SQLITE_CONSTRAINT_FOREIGNKEY";
}
