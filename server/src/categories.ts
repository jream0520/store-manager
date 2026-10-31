import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface Category {
  id: number;
  name: string;
  itemCount: number;
}

const nameBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: { type: "string", minLength: 1, maxLength: 60, pattern: "\\S" } },
} as const;

export function listCategories(db: Database.Database): Category[] {
  return db
    .prepare(
      `SELECT c.id, c.name, COUNT(i.id) AS itemCount
       FROM categories c LEFT JOIN items i ON i.category_id = c.id AND i.archived_at IS NULL
       GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
    )
    .all() as Category[];
}

export function categoryRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.get("/api/categories", async () => listCategories(db));

    app.post<{ Body: { name: string } }>("/api/categories", { schema: { body: nameBody } }, async (req, reply) => {
      try {
        const r = db.prepare("INSERT INTO categories (name) VALUES (?)").run(req.body.name.trim());
        return reply.code(201).send({ id: Number(r.lastInsertRowid), name: req.body.name.trim(), itemCount: 0 });
      } catch (e) {
        if (isUnique(e)) return reply.code(409).send({ error: "a category with that name exists" });
        throw e;
      }
    });

    app.patch<{ Params: { id: number }; Body: { name: string } }>(
      "/api/categories/:id",
      { schema: { params: idParams, body: nameBody } },
      async (req, reply) => {
        try {
          const r = db.prepare("UPDATE categories SET name = ? WHERE id = ?").run(req.body.name.trim(), req.params.id);
          if (!r.changes) return reply.code(404).send({ error: "not found" });
          return listCategories(db).find((c) => c.id === req.params.id);
        } catch (e) {
          if (isUnique(e)) return reply.code(409).send({ error: "a category with that name exists" });
          throw e;
        }
      },
    );

    // Items in a deleted category become uncategorised (ON DELETE SET NULL).
    app.delete<{ Params: { id: number } }>("/api/categories/:id", { schema: { params: idParams } }, async (req, reply) => {
      const r = db.prepare("DELETE FROM categories WHERE id = ?").run(req.params.id);
      if (!r.changes) return reply.code(404).send({ error: "not found" });
      return reply.code(204).send();
    });
  };
}

export const idParams = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "integer", minimum: 1 } },
} as const;

function isUnique(e: unknown): boolean {
  return (e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE";
}
