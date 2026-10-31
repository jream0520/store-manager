import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";
import { idParams } from "./categories.js";
import { getItem, type Item, type Status } from "./items.js";

// Status changes other than selling (M5). Each action lists the statuses it may start from;
// a bulk request is all-or-nothing so a mixed selection never half-applies.
export const ACTIONS = {
  place: { from: ["in_studio"], to: "in_shop" },
  pull: { from: ["in_shop"], to: "in_studio" },
  write_off: { from: ["in_studio", "in_shop"], to: "written_off" },
  restore: { from: ["written_off"], to: "in_studio" },
} as const satisfies Record<string, { from: readonly Status[]; to: Status }>;

export type Action = keyof typeof ACTIONS;
export const WRITE_OFF_REASONS = ["lost", "damaged", "gifted", "kept", "other"] as const;

export interface StatusRequest {
  ids: number[];
  action: Action;
  /** YYYY-MM-DD, the owner's local date. Defaults to today (UTC) if omitted. */
  date?: string;
  location?: string;
  reason?: (typeof WRITE_OFF_REASONS)[number];
  note?: string;
}

export type StatusResult =
  | { ok: true; items: Item[] }
  | { ok: false; missing: number[]; conflicts: { id: number; status: Status }[] };

export function applyStatusAction(db: Database.Database, req: StatusRequest): StatusResult {
  const rule = ACTIONS[req.action];
  const date = req.date ?? new Date().toISOString().slice(0, 10);
  const ids = [...new Set(req.ids)];
  const note = [req.reason, req.note?.trim()].filter(Boolean).join(": ");

  return db.transaction((): StatusResult => {
    const rows = db
      .prepare(`SELECT id, status FROM items WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { id: number; status: Status }[];
    const found = new Map(rows.map((r) => [r.id, r.status]));
    const missing = ids.filter((id) => !found.has(id));
    const conflicts = rows.filter((r) => !(rule.from as readonly Status[]).includes(r.status));
    if (missing.length || conflicts.length) return { ok: false, missing, conflicts };

    const setStatus = db.prepare("UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?");
    const event = db.prepare(
      "INSERT INTO item_events (item_id, kind, from_status, to_status, happened_on, note) VALUES (?, 'status', ?, ?, ?, ?)",
    );
    const openPlacement = db.prepare("INSERT INTO placements (item_id, placed_on, location) VALUES (?, ?, ?)");
    const closePlacement = db.prepare(
      "UPDATE placements SET removed_on = ? WHERE item_id = ? AND removed_on IS NULL",
    );

    for (const id of ids) {
      const from = found.get(id)!;
      setStatus.run(rule.to, id);
      event.run(id, from, rule.to, date, req.action === "place" ? (req.location?.trim() ?? "") : note);
      if (from === "in_shop") closePlacement.run(date, id);
      if (rule.to === "in_shop") openPlacement.run(id, date, req.location?.trim() ?? "");
    }
    return { ok: true, items: ids.map((id) => getItem(db, id)!) };
  })();
}

export type HistoryEntry =
  | { type: "status"; from: Status; to: Status; on: string; note: string; recordedAt: string }
  | { type: "price"; oldCents: number | null; newCents: number | null; recordedAt: string };

/** Newest entry first (an audit log). Status entries also carry the date the change happened. */
export function itemHistory(db: Database.Database, itemId: number): HistoryEntry[] {
  const rows = db.prepare("SELECT * FROM item_events WHERE item_id = ? ORDER BY id DESC").all(itemId) as {
    kind: "status" | "price";
    from_status: Status;
    to_status: Status;
    happened_on: string;
    old_cents: number | null;
    new_cents: number | null;
    note: string;
    created_at: string;
  }[];
  return rows.map((r): HistoryEntry =>
    r.kind === "status"
      ? { type: "status", from: r.from_status, to: r.to_status, on: r.happened_on, note: r.note, recordedAt: r.created_at }
      : { type: "price", oldCents: r.old_cents, newCents: r.new_cents, recordedAt: r.created_at },
  );
}

/** Accepts a real calendar date that isn't after tomorrow (UTC), allowing for time zones. */
export function isValidDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  return d.getTime() <= Date.now() + 24 * 60 * 60 * 1000;
}

export function statusRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.post<{ Body: StatusRequest }>(
      "/api/items/status",
      {
        schema: {
          body: {
            type: "object",
            required: ["ids", "action"],
            additionalProperties: false,
            properties: {
              ids: { type: "array", minItems: 1, maxItems: 500, items: { type: "integer", minimum: 1 } },
              action: { type: "string", enum: Object.keys(ACTIONS) },
              date: { type: "string" },
              location: { type: "string", maxLength: 100 },
              reason: { type: "string", enum: WRITE_OFF_REASONS },
              note: { type: "string", maxLength: 500 },
            },
          },
        },
      },
      async (req, reply) => {
        if (req.body.date !== undefined && !isValidDay(req.body.date)) {
          return reply.code(400).send({ error: "date must be a real date, not in the future" });
        }
        if (req.body.action === "write_off" && !req.body.reason) {
          return reply.code(400).send({ error: "a reason is required to write items off" });
        }
        const result = applyStatusAction(db, req.body);
        if (!result.ok) {
          return reply.code(409).send({
            error: result.missing.length ? "some items don't exist" : "some items can't make that change",
            missing: result.missing,
            conflicts: result.conflicts,
          });
        }
        return { items: result.items };
      },
    );

    app.get<{ Params: { id: number } }>("/api/items/:id/history", { schema: { params: idParams } }, async (req, reply) => {
      if (!getItem(db, req.params.id)) return reply.code(404).send({ error: "not found" });
      return itemHistory(db, req.params.id);
    });

    // Edit where an item sits in the shop (shelf, table…) without changing status.
    app.patch<{ Params: { id: number }; Body: { location: string } }>(
      "/api/items/:id/placement",
      {
        schema: {
          params: idParams,
          body: {
            type: "object",
            required: ["location"],
            additionalProperties: false,
            properties: { location: { type: "string", maxLength: 100 } },
          },
        },
      },
      async (req, reply) => {
        const r = db
          .prepare("UPDATE placements SET location = ? WHERE item_id = ? AND removed_on IS NULL")
          .run(req.body.location.trim(), req.params.id);
        if (!r.changes) return reply.code(409).send({ error: "item isn't in the shop" });
        return getItem(db, req.params.id);
      },
    );
  };
}
