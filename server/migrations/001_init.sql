-- Key/value app settings (shop name, currency, etc.). Domain tables arrive in M2+.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
