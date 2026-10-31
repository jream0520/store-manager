import type { FastifyInstance, FastifyRequest } from "fastify";
import type Database from "better-sqlite3";

// Reading the audit log (F30). Rows are written by triggers (migration 008) and by
// logAuthEvent for sign-in activity.

export type AuthEvent = "login" | "login_failed" | "logout" | "password_changed" | "signed_out_everywhere";

export function logAuthEvent(db: Database.Database, action: AuthEvent, req: FastifyRequest) {
  db.prepare("INSERT INTO audit_log (entity, action, new_row) VALUES ('auth', ?, ?)").run(
    action,
    JSON.stringify({ ip: req.ip, userAgent: String(req.headers["user-agent"] ?? "").slice(0, 200) }),
  );
}

export interface AuditEntry {
  id: number;
  at: string;
  entity: string;
  entityId: number | null;
  action: string;
  /** The item this change concerns, when there is one (items, sales, photos, placements). */
  item: { id: number; number: number; name: string } | null;
  changes: { field: string; from: unknown; to: unknown }[];
}

interface Row {
  id: number;
  at: string;
  entity: string;
  entity_id: number | null;
  action: string;
  old_row: string | null;
  new_row: string | null;
}

export function readAudit(db: Database.Database, opts: { before?: number; limit?: number; entity?: string }): AuditEntry[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.before) (where.push("id < ?"), params.push(opts.before));
  if (opts.entity) (where.push("entity = ?"), params.push(opts.entity));
  const rows = db
    .prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
    .all(...params, opts.limit ?? 50) as Row[];

  const itemById = db.prepare("SELECT id, number, name FROM items WHERE id = ?");
  return rows.map((r) => {
    const oldRow = r.old_row ? (JSON.parse(r.old_row) as Record<string, unknown>) : null;
    const newRow = r.new_row ? (JSON.parse(r.new_row) as Record<string, unknown>) : null;
    const keys = Object.keys(newRow ?? oldRow ?? {});
    const changes = keys
      .filter((k) => !oldRow || !newRow || JSON.stringify(oldRow[k]) !== JSON.stringify(newRow[k]))
      .map((k) => ({ field: k, from: oldRow?.[k] ?? null, to: newRow?.[k] ?? null }))
      // A new or removed row's empty fields aren't news.
      .filter((c) => r.action !== "create" || (c.to !== null && c.to !== ""))
      .filter((c) => r.action !== "delete" || (c.from !== null && c.from !== ""));

    let item: AuditEntry["item"] = null;
    const row = newRow ?? oldRow ?? {};
    if (r.entity === "items") {
      item = { id: r.entity_id!, number: row.number as number, name: row.name as string };
    } else if (typeof row.item_id === "number") {
      item = (itemById.get(row.item_id) as AuditEntry["item"]) ?? null;
    }
    return { id: r.id, at: r.at, entity: r.entity, entityId: r.entity_id, action: r.action, item, changes };
  });
}

export function auditRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.get<{ Querystring: { before?: number; limit?: number; entity?: string } }>(
      "/api/audit",
      {
        schema: {
          querystring: {
            type: "object",
            additionalProperties: false,
            properties: {
              before: { type: "integer", minimum: 1 },
              limit: { type: "integer", minimum: 1, maximum: 200 },
              entity: {
                type: "string",
                enum: ["items", "categories", "settings", "sales", "shop_reports", "expenses", "photos", "placements", "auth"],
              },
            },
          },
        },
      },
      async (req) => readAudit(db, req.query),
    );
  };
}
