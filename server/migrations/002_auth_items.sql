-- M2: single-user auth, categories, items.

-- One row: the owner. Set with `node server/dist/cli.js set-password`.
CREATE TABLE users (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Session tokens are stored hashed; the raw token lives only in the cookie.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_expires ON sessions (expires_at);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AUTOINCREMENT guarantees ids are never reused, so the id doubles as the
-- hand-written tag number (PRD F2).
CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
  tags TEXT NOT NULL DEFAULT '[]',          -- JSON array of lowercase strings
  cost_cents INTEGER CHECK (cost_cents >= 0),
  price_cents INTEGER CHECK (price_cents >= 0),
  status TEXT NOT NULL DEFAULT 'in_studio'
    CHECK (status IN ('in_studio', 'in_shop', 'sold', 'returned', 'written_off')),
  notes TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX items_status ON items (status);
CREATE INDEX items_category ON items (category_id);
CREATE INDEX items_created ON items (created_at);
