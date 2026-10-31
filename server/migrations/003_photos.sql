-- M3: item photos. Files live at <data>/photos/<id>.jpg and <id>.thumb.jpg.
-- The cover photo is the one with the lowest sort_order.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,                       -- UUID; also the file name
  item_id INTEGER NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX photos_item ON photos (item_id, sort_order);
