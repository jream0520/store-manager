-- M5: sales and the shop's periodic sales reports.

-- One report from the shop covering a date range. Sales entered while reconciling link to it.
CREATE TABLE shop_reports (
  id INTEGER PRIMARY KEY,
  period_start TEXT NOT NULL,                -- YYYY-MM-DD
  period_end TEXT NOT NULL,
  received_on TEXT,
  reported_count INTEGER CHECK (reported_count >= 0),
  reported_total_cents INTEGER CHECK (reported_total_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  reconciled_at TEXT,                        -- set when the owner marks it done
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (period_end >= period_start)
);

-- An item sells at most once (UNIQUE item_id): a second entry for the same number is a
-- duplicate on the report, not a second sale. Undoing a sale deletes its row.
CREATE TABLE sales (
  id INTEGER PRIMARY KEY,
  item_id INTEGER NOT NULL UNIQUE REFERENCES items (id) ON DELETE CASCADE,
  sale_date TEXT NOT NULL,                   -- YYYY-MM-DD
  sold_cents INTEGER NOT NULL CHECK (sold_cents >= 0),
  -- Retail price at the time of sale, to flag sales at a different price (F18).
  -- Profit (F21) uses the item's current cost, which is often filled in later.
  retail_cents INTEGER,
  previous_status TEXT NOT NULL,             -- restored on undo
  report_id INTEGER REFERENCES shop_reports (id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX sales_date ON sales (sale_date);
CREATE INDEX sales_report ON sales (report_id);
