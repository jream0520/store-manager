# Store Manager — Implementation Milestone Plan

Derived from PRD.md (approved 2026-10-30). Each milestone ends with something runnable and testable on a real iPhone. F-numbers refer to PRD requirements.

## Sequencing summary

| # | Milestone | Outcome | PRD items |
|---|---|---|---|
| M0 | Foundations and tech decisions | Repo, stack chosen, container builds and serves hello-world over HTTPS via the existing proxy | §9, §12 |
| M1 | Device and deploy spike | PWA installs on iPhone, camera capture uploads a photo to the server | F8, F27 (partial) |
| M2 | Auth and item core | Log in, create/edit/list/search items | F1–F4, F27, F28 |
| M3 | Photos | Multi-photo items, thumbnails, cover photo | F8–F10 |
| M4 | Shop placement and status | Place/pull items, "In shop now" view, status history | F3, F12–F14 |
| M5 | Sales and reconciliation | Mark sold, reconcile a shop report | F15–F18, F21 |
| M6 | Dashboard, reports, expenses | Profit views, expenses, aging, CSV export | F5, F22–F26 |
| M7 | Hardening and operations | Backups, restore, audit log, docs, release | F29, F30, §8 |
| M8 | Post-v1 (parking lot) | CSV report import, QR labels, etc. | F19, F20, F11 |

M1 is deliberately early: iOS PWA and camera behavior is the largest risk, so it is proven before building features on top.

---

## M0 — Foundations and tech decisions
**Goal:** Settle open questions and have a working skeleton.
- ✅ Resolve PRD §12 open questions (see PRD §12).
- ✅ Choose the stack (ADR 0001).
- ✅ Repo structure, test runner, build scripts.
- ✅ Dockerfile (multi-stage) and `docker-compose.yml` with a volume for `/data`; image verified locally.
- ✅ Health endpoint, config via environment variables, structured logging.
- ✅ Route the host's existing reverse proxy to the container (served at `/store/`) and deploy via `deploy.ps1`.

**Done when:** `docker compose up` on the host serves the placeholder page at `https://<your-domain>` through the existing proxy.

## M1 — Device and deploy spike
**Goal:** Retire the iOS risk.
- ✅ Minimal PWA: manifest, PNG icons (incl. apple-touch-icon), service worker for app shell only.
- ✅ Add to Home Screen on iPhone; launches standalone (verified on device 2026-10-31). iPad not yet tried.
- ✅ Camera capture (`<input capture>`) plus library picker; client-side resize to 2000 px JPEG with EXIF orientation applied; upload behind a temporary key; display it back. Verified on iPhone and with an EXIF-rotated fixture.
- ✅ Storage survives background/relaunch (launch counter, verified on device).
- ⬜ Service worker status on device not yet reported.

**Done when:** a photo taken on the iPhone appears on the server volume and in the app, from the installed Home Screen app.

## M2 — Auth and item core
**Goal:** A usable catalog without photos.
- ✅ Single-user password set via CLI in the container (no web first-run, since the site is public), scrypt hashing, 90-day sliding sessions in an httpOnly cookie, CSRF header guard, login rate limiting (F27). Password change in Settings.
- ✅ Settings: shop name, categories, currency (F28).
- ✅ Item schema and migrations; search by "42", "0042" or "#42" (F2).
- ✅ Revised after M5: item numbers are the owner's own pre-assigned tag numbers, separate from the internal id. Editable on new, quick-add and edit screens, with a suggested default and a live duplicate check; the server refuses duplicates (migration 006).
- ✅ Create/edit/archive item (F1); list with search, filters, sort, filters kept in the URL (F4).
- ✅ Quick-add path; items missing price, cost or category are flagged incomplete (F7).
- ✅ App shell: bottom tab bar, mobile-first layout, light/dark mode.
- ✅ M1 photo spike endpoints and page removed; the resize code is kept for M3.
- ✅ Verified on iPhone after deploy (2026-10-31).

**Done when:** you can sign in from your phone and add, find, and edit items. Unit and API tests cover the item lifecycle.

## M3 — Photos
**Goal:** Photo-driven item entry.
- ✅ Photos on items: up to 12 per item, camera or library (multi-select), first photo is the cover, make-cover/reorder/delete in a full-screen viewer (F8, F10).
- ✅ Thumbnails generated on the phone with the full image (≤ 2000 px + ≤ 480 px JPEGs); the server validates JPEG structure and size and stores both as-is. Lazy-loaded thumbs in the list (F9). See ADR 0001 for why not server-side.
- ✅ Camera-first new item: photos can be taken before the item is saved and upload on create (F11). Quick add takes one photo.
- ✅ Storage at `data/photos/<uuid>.jpg` and `.thumb.jpg`; temp-file writes; orphan and temp files swept at startup; immutable cache headers.
- ✅ Verified on iPhone: camera, library and HEIC photos (2026-10-31).

**Done when:** the add-item flow from camera to saved record takes under 30 seconds, and the list scrolls smoothly with a few hundred photos.

## M4 — Shop placement and status
**Goal:** Know what is where.
- ✅ Status changes as explicit actions (place, pull back, write off, restore), each with an owner-chosen date (backdating allowed, not future). Bulk requests are all-or-nothing. Status can't be set through the item edit form (F3).
- ✅ Bulk select on the Items and In shop lists; actions offered are those valid for every selected item. Place in shop takes a date and an optional location, editable later (F12).
- ✅ "In shop" tab: everything on display, longest-placed first, days in shop and location per row, total count and retail value (F13).
- ✅ Pull back to studio (bulk); write off with a required reason (lost, damaged, gifted, kept, other) plus note; restore (F14).
- ✅ Item history: one `item_events` log of status and price changes, newest first (F5).
- Decision: `Returned` is reserved for a sold item coming back from a customer (M5). Pulling an item from the shop sets it to `In studio`.
- ✅ Verified on iPhone after deploy (2026-10-31).

**Done when:** you can move a batch of items into the shop and see accurate in-shop lists and totals.

## M5 — Sales and reconciliation
**Goal:** The core workflow: shop report → recorded sales.
- ✅ Mark sold from the item page with date and price (default retail); edit and undo. Undo restores the previous status and reopens the shop placement with its original date and location (F15).
- ✅ Shop reports: period, received date, optional reported item count and total; editable; mark reconciled or reopen; delete keeps the sales (unlinked).
- ✅ Reconcile screen: number entry → photo, status, location and retail shown → sold price and sticky sale date → record → focus returns to the number box. "Pick from what's in the shop" fallback. Running count and total against the reported figures, with "matches" or what's still off (F16, F17).
- ✅ Discrepancies: unknown number; already sold (duplicate line or misread number, shows when and which report); not in shop (needs "Record anyway"); sold price differs from retail (flagged on the line); written-off/archived items can't be sold (F18).
- ✅ Profit per sale uses the item's current cost; totals count sales without a cost separately. Sales tab shows this month's count, sales and profit (F21).
- Not built: customer returns of a sold item (the reserved `Returned` status). Undo covers mistakes; a real return can be handled later if it happens.
- ⬜ Reconcile a real report on the iPhone and time it. (Reconcile now looks items up by tag number.)

**Done when:** a sample real report can be reconciled end-to-end in under 5 minutes and the totals match.

## M6 — Dashboard, reports, expenses
**Goal:** See how the business is doing.
- ✅ Dashboard at the top of the Sales tab: this month / this year sales, profit, expenses and net; stock counts and in-shop retail value; alerts for items in the shop over 60/90 days and unsold items missing details; last 10 changes (F23).
- ✅ Expenses page: booth rent, fees, supplies, marketing, other; grouped by month; tap to edit or delete; one-tap "Rent again" (F22).
- ✅ Profit report: presets (this month, last month, this year, last 12 months, custom); profit-and-loss summary, by-month bars, by-category table with average days to sell, top sales (F24).
- ✅ Aging: dashboard alerts link to the In shop list, which already sorts longest-in-shop first (F25).
- ✅ CSV export of items, sales and expenses (spreadsheet-safe: amounts as decimals, formula injection neutralized, UTF-8 BOM) (F26).
- Decision: profit everywhere = sold price − materials cost. A sale with no cost yet counts as zero cost and is flagged ("may be high") rather than left out. Net = profit − expenses.
- ⬜ Verify on iPhone after deploy (including CSV download from the Home Screen app).

**Done when:** report numbers match a hand calculation on a test dataset.

## M7 — Hardening and operations
**Goal:** Safe to trust with real data.
- Backup: scheduled snapshot or a built-in full export of the DB and photos (F29); a tested restore procedure and a restore-drill test.
- Audit log (F30).
- Security review: headers, cookie flags, rate limits, dependency audit, optional network restriction guide.
- Setup and operations docs: install, reverse-proxy setup, upgrade, backup, restore.
- Real-device regression pass on iPhone and iPad; performance check with a large dataset.
- Tag v1.0.

**Done when:** a fresh host can be restored from a backup into an identical working state, and you are running real inventory on it.

## M8 — Post-v1 backlog (not committed)
- CSV or spreadsheet import of the shop's report, matching by item number (F19); attach the original report file (F20).
- QR labels and scan-to-open; label printing.
- Passkey login.
- Offline mode.

---

## Cross-cutting practices
- Every milestone ships with tests for its core flows and an updated README/changelog.
- Database migrations are forward-only and tested against a copy of seed data.
- Each milestone is deployed to the real host and checked on the real phone before the next begins.
- Scope changes go through the PRD's parking lot, not into the current milestone.

## Rough sizing (single developer, part time; treat as a guide)
M0 small · M1 small · M2 medium · M3 medium · M4 small · M5 medium-large · M6 medium · M7 medium.
