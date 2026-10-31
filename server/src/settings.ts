import type { FastifyInstance } from "fastify";
import type Database from "better-sqlite3";

export interface Settings {
  shopName: string;
  currency: string;
}

const DEFAULTS: Settings = { shopName: "", currency: "USD" };

export function getSettings(db: Database.Database): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    shopName: stored.shopName ?? DEFAULTS.shopName,
    currency: stored.currency ?? DEFAULTS.currency,
  };
}

export function settingsRoutes(db: Database.Database) {
  return async function (app: FastifyInstance) {
    app.get("/api/settings", async () => getSettings(db));

    app.patch<{ Body: Partial<Settings> }>(
      "/api/settings",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            minProperties: 1,
            properties: {
              shopName: { type: "string", maxLength: 100 },
              currency: { type: "string", pattern: "^[A-Z]{3}$" },
            },
          },
        },
      },
      async (req) => {
        const upsert = db.prepare(
          "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        );
        db.transaction(() => {
          for (const [k, v] of Object.entries(req.body)) upsert.run(k, String(v).trim());
        })();
        return getSettings(db);
      },
    );
  };
}
