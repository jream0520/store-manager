-- M6: business costs that aren't tied to one item (booth rent, card fees, supplies…), so
-- reports can show net profit (F22).
CREATE TABLE expenses (
  id INTEGER PRIMARY KEY,
  spent_on TEXT NOT NULL,                    -- YYYY-MM-DD
  category TEXT NOT NULL CHECK (category IN ('rent', 'fees', 'supplies', 'marketing', 'other')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX expenses_date ON expenses (spent_on);
