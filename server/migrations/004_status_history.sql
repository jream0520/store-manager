-- M4: item history (status and price changes) and shop placements.

-- One log for every change to an item, so `id` is the true entry order.
--   kind 'status': from_status → to_status on happened_on (the owner's date, may be backdated)
--   kind 'price':  old_cents → new_cents
CREATE TABLE item_events (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('status', 'price')),
  from_status TEXT,
  to_status TEXT,
  happened_on TEXT,                          -- YYYY-MM-DD (owner's local date)
  old_cents INTEGER,
  new_cents INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX item_events_item ON item_events (item_id, id);

-- A stretch of time an item spent on display. The open one (removed_on IS NULL) is current.
CREATE TABLE placements (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  placed_on TEXT NOT NULL,                   -- YYYY-MM-DD
  removed_on TEXT,
  location TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX placements_one_open ON placements (item_id) WHERE removed_on IS NULL;
