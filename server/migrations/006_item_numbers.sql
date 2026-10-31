-- Item numbers become the owner's own tag numbers (pre-printed tags, not always entered in
-- order) instead of being tied to the row id. Existing items keep the number they already have.
ALTER TABLE items ADD COLUMN number INTEGER;
UPDATE items SET number = id;
CREATE UNIQUE INDEX items_number ON items (number);
