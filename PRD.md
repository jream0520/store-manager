# Store Manager — Product Requirements Document

Status: **APPROVED v1.1** — open questions resolved (see §12)
Date: 2026-10-30

## 1. Overview

Store Manager is a private, self-hosted web app for a single maker/vendor who rents a booth or space in a boutique shop. The owner catalogs unique pieces, tracks which are on display in the shop, sets prices, and records sales that the shop reports periodically. The app calculates profit per item (sale price minus materials cost) and shows what is where at a glance.

It runs as one Docker container on the owner's hosted server and is used from an iPhone/iPad as an installable web app (PWA). There is no native app, App Store, or code signing.

## 2. Context and assumptions (from discovery)

| Topic | Decision |
|---|---|
| Users | One user (the owner). Single login, no roles. Stays solo. |
| Shops | One shop. The data model keeps a `shop` record, but no multi-shop UI is planned. |
| Business model | Booth/space rental. The owner keeps sale proceeds. Payments are taken by the shop, which pays the owner; the app does **not** process payments or track payouts. |
| Sales tax | Collected and remitted by the shop. The app ignores tax. |
| Inventory | Mostly unique, one-of-a-kind pieces. Each item is its own record (quantity = 1). Small scale: under a few hundred items/year, 1–3 photos each. |
| Physical tags | Hand-written price tags. The owner writes the app's item number on each tag. |
| Sales intake | The shop sends periodic reports (email/PDF/spreadsheet) that identify each sale **by the owner's item number**. The owner enters sales by hand. |
| Financials | Retail price, sold price, sale date, and a single materials-cost total per item, giving profit per item. |
| Existing data | None to import; the few current items are entered by hand. |
| Connectivity | Reliable, online-only. No offline mode in v1. |
| Hosting | The owner's server already runs a TLS reverse proxy; the app container sits behind it. |
| Client | PWA on iOS Safari, added to the Home Screen. |

## 3. Goals and non-goals

### Goals
1. Add a new item in under 30 seconds from a phone (photo, name, price, cost).
2. Always know the status and location of every piece (in studio / in shop / sold).
3. Make reconciling a periodic shop report fast and error-resistant.
4. Show profit per item and per period.
5. Run reliably as a single container with simple, verifiable backups.

### Non-goals (v1)
- Point-of-sale or payment processing.
- Multi-user accounts, roles, or shop-facing logins.
- Offline operation.
- Multi-quantity SKUs and size/color variants.
- Native iOS app or App Store distribution.
- E-commerce/online storefront, accounting-package integration, tax filing.

## 4. User stories

- As the owner, I can photograph a new piece and create an item record in a few taps.
- As the owner, I can mark an item "placed in shop" and note the date, so I know what is on display.
- As the owner, I can change an item's price and see the price history.
- As the owner, when the shop's report arrives, I can mark items sold with sale date and sold price, matching the report line by line.
- As the owner, I can see profit per item, and total sales, cost, and profit for any date range.
- As the owner, I can find an item fast (search, filter by status/category/tag).
- As the owner, I can pull an item back from the shop (returned to studio) or mark it lost/damaged.
- As the owner, I can export my data and trust it is backed up.

## 5. Functional requirements

Priority: **P0** = must for v1, **P1** = should for v1, **P2** = later.

### 5.1 Items
- **F1 (P0)** Create/edit/archive an item with: name, description, category, tags, materials cost, retail price, status, optional SKU/tag number, notes.
- **F2 (P0)** Auto-generated short, sequential numeric item number (e.g. `42`, displayed `0042`) that is easy to hand-write on a price tag and is shown prominently on the item screen. Numbers are never reused. Lookup ignores leading zeros.
- **F3 (P0)** Status lifecycle: `In studio` → `In shop` → `Sold`. Also `Returned` and `Written off` (lost/damaged/gifted). Every status change is timestamped.
- **F4 (P0)** List view with thumbnail, price, status. Search by name/number/tag; filter by status and category; sort by date, price.
- **F5 (P1)** Price history (each change is logged with date).
- **F6 (P1)** Duplicate an item as a template for similar pieces.
- **F7 (P1)** Quick-add mode: capture a photo, enter a name and price, and fill in the rest later (item flagged "incomplete").

### 5.2 Photos (bonus feature, in v1 scope)
- **F8 (P0)** Take a photo with the device camera or pick from the library, attached to an item. Multiple photos per item; one is the cover.
- **F9 (P0)** The client downsizes images before upload (e.g. max 2000px, JPEG). The server stores the original-ish copy plus a thumbnail. Handles iPhone HEIC/orientation correctly.
- **F10 (P1)** Reorder, delete, and set the cover photo.
- **F11 (P2)** Camera-first "new item" flow.

### 5.3 Shop placement
- **F12 (P0)** Mark one or more items "placed in shop" (bulk select) with a date. Optionally record a location note (shelf/table).
- **F13 (P0)** "In shop now" view: everything currently on display, with total retail value.
- **F14 (P1)** Pull back from shop (bulk), returning items to studio.

### 5.4 Sales and reconciliation
- **F15 (P0)** Mark an item sold: sale date, sold price (defaults to retail price), optional note. Editable and undoable.
- **F16 (P0)** **Reconcile a shop report**: create a report period, then enter each sold item **by item number** (number pad → item shown with photo and retail price → confirm sold price/date → next). Picking from the "In shop" list is the fallback. Each sale is linked to the report.
- **F17 (P1)** Running reconciliation checklist: items sold since the last report period, so nothing is missed. Shows the count and total sold price to compare against the shop's report total.
- **F18 (P1)** Detect discrepancies: an unknown item number, a sold item not in the shop, a sold price differing from retail, a duplicate sale.
- **F19 (P2)** CSV import of a shop's spreadsheet report, matching by item number.
- **F20 (P2)** Attach the shop's original report file (PDF/XLSX) to a report period for reference.

### 5.5 Costs and profit
- **F21 (P0)** Per-item materials cost; profit = sold price − materials cost.
- **F22 (P1)** Shop-level costs (booth rent, card fees, other) as dated expense entries, to get true net profit. This is not required to use the app, but it is the most common thing missed in booth-rental setups.

### 5.6 Reports and dashboard
- **F23 (P0)** Dashboard: counts by status, in-shop retail value, sales and profit this month and YTD, recent activity.
- **F24 (P1)** Sales/profit report by date range and category, with best sellers and average days-to-sell.
- **F25 (P1)** Aging: items in the shop longest without selling.
- **F26 (P1)** CSV export of items, sales, and expenses.

### 5.7 Administration
- **F27 (P0)** Single-user login (password, plus an optional passkey later), long-lived session so the phone stays signed in.
- **F28 (P0)** Settings: shop name, categories, currency.
- **F29 (P1)** Full data export (database plus photos zip) and a restore procedure.
- **F30 (P1)** Audit log of edits (what changed, when).

## 6. Data model (initial sketch)

- **Item**: id, number, name, description, category_id, tags, cost, price, status, created_at, updated_at, archived
- **Photo**: id, item_id, file_path, thumb_path, is_cover, sort_order, created_at
- **StatusEvent**: id, item_id, status, at, note
- **PriceChange**: id, item_id, old, new, at
- **Shop**: id, name, notes (one row in v1)
- **Placement**: id, item_id, shop_id, placed_at, removed_at, location_note
- **Sale**: id, item_id, sale_date, sold_price, report_id (nullable), note
- **ShopReport**: id, shop_id, period_start, period_end, received_at, reported_total, attachment_path
- **Expense**: id, shop_id (nullable), date, type, amount, note
- **Category**, **Setting**, **User**

## 7. UX requirements

- Mobile-first, thumb-friendly layout; also usable on iPad and a desktop browser.
- Installable PWA: Home Screen icon, full-screen mode, and a correct manifest and icons.
- Big tap targets, minimal typing (pickers, defaults, recent values).
- Fast list scrolling with lazy-loaded thumbnails.
- Camera capture is one tap from the "add item" screen.
- Light and dark mode following the system setting.
- Clear confirmation and undo for sales, status changes, and deletes.

## 8. Non-functional requirements

- **Deployment**: one Docker image, run via `docker compose`. Configuration by environment variables. Persistent volumes for the database and photos.
- **HTTPS**: required for the iOS camera and PWA install. TLS is terminated by the reverse proxy already running on the host; the container listens on plain HTTP and is not exposed publicly on its own.
- **Storage**: SQLite on a volume (a single user does not need a database server) and photos on the filesystem.
- **Backups**: documented, tested backup of the DB and photos (scheduled snapshot or a built-in export), with a restore procedure.
- **Security**: login required for everything, secure session cookies, rate-limited login, no public registration. Optional network restriction (VPN/IP allowlist) is documented.
- **Performance**: page loads under about 1s on shop Wi-Fi; thousands of items and photos should be fine.
- **Browser support**: current and previous major iOS Safari; current desktop Chrome/Safari/Firefox.
- **Maintainability**: small dependency footprint, automated tests for the core flows (add item, place, sell, reconcile, profit).

## 9. Proposed technical approach (to be confirmed in design)

- Single container: a TypeScript or Python backend serving a JSON API and the static PWA build.
- SQLite with migrations; photos on a mounted volume with generated thumbnails.
- Front end: a lightweight SPA (Svelte, Preact, or React) built as a PWA.
- Image handling: resize on the client with canvas before upload; generate thumbnails on the server.
- Final stack choice is deferred to Milestone 0.

## 10. Success metrics

- Adding an item with a photo takes under 30 seconds.
- Reconciling a typical report (about 10–20 sales) takes under 5 minutes.
- Zero lost data across restore tests.
- The app is used from the phone without needing a desktop.

## 11. Risks

| Risk | Mitigation |
|---|---|
| iOS PWA quirks (camera, storage eviction, no push) | Test on a real device early (M1); the server is the source of truth. |
| Proxy misconfiguration (upload size limits, forwarded headers) | Document nginx/Caddy/Traefik snippets, including body-size limits for photo uploads. |
| Hand-written item numbers misread by the shop | Short numeric numbers; reconcile shows the photo before confirming; unknown-number flag (F18). |
| Photo storage growth | Low at expected scale; downscale on upload and generate thumbnails anyway. |
| Data loss on a self-hosted box | Built-in export plus a documented backup. |
| Scope creep toward POS | Non-goals above; revisit after v1. |

## 12. Resolved decisions (2026-10-30)

| Question | Answer | Effect |
|---|---|---|
| Payouts | Shop pays the owner; no tracking needed | No payout entity. Expenses (F22) stay optional. |
| Sales tax | Shop handles it | No tax fields. |
| Item tags | Hand-written price tags | F2: short numeric item numbers. QR labels stay P2. |
| Report identifies items by | The owner's item number | F16: enter-by-number reconcile flow. F19 import becomes simple. |
| HTTPS | Existing reverse proxy on the host | Bundled Caddy removed; proxy snippets in README. |
| Existing inventory | Few items, entered by hand | No import feature. |
| Materials cost | Single total per item | Confirmed as in F21. |
| Scale and growth | Small, stays solo | No multi-user or multi-shop work planned. |

## 13. Out of scope for v1 (parking lot)

Offline mode, QR/barcode scanning and label printing, shop-facing login, multi-shop UI, CSV/PDF report import, payout tracking, online storefront, payments, tax reports, inventory forecasting.
