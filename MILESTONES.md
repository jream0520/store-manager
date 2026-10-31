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
- ⬜ Route the host's existing reverse proxy to the container (README snippets) and deploy.

**Done when:** `docker compose up` on the host serves the placeholder page at `https://<your-domain>` through the existing proxy.

## M1 — Device and deploy spike
**Goal:** Retire the iOS risk.
- Minimal PWA: manifest, icons, service worker for app shell only.
- Add to Home Screen on iPhone and iPad; full-screen launch.
- Camera capture (`<input capture>` or `getUserMedia`) plus library picker; client-side resize and orientation fix (HEIC → JPEG); upload to the server; display it back.
- Verify behavior after the app is backgrounded and relaunched.

**Done when:** a photo taken on the iPhone appears on the server volume and in the app, from the installed Home Screen app.

## M2 — Auth and item core
**Goal:** A usable catalog without photos.
- Single-user setup (first-run password creation or env-seeded), login, long-lived secure session, login rate limiting (F27).
- Settings: shop name, categories, currency (F28).
- Item schema and migrations; short sequential item numbers that are never reused, with lookup that ignores leading zeros (F2).
- Create/edit/archive item (F1); list with search, filters, sort (F4).
- Quick-add path with the "incomplete" flag (F7).
- App shell: navigation, mobile-first layout, light/dark mode.

**Done when:** you can sign in from your phone and add, find, and edit items. Unit and API tests cover the item lifecycle.

## M3 — Photos
**Goal:** Photo-driven item entry.
- Photo attach to items: multiple per item, cover photo, reorder, delete (F8, F10).
- Server thumbnails and lazy-loaded thumbs in lists (F9).
- Camera-first new-item flow (F11 if time allows; otherwise M8).
- Storage layout on the volume, orphan cleanup, size limits.

**Done when:** the add-item flow from camera to saved record takes under 30 seconds, and the list scrolls smoothly with a few hundred photos.

## M4 — Shop placement and status
**Goal:** Know what is where.
- Status lifecycle with timestamped StatusEvents (F3).
- Bulk "place in shop" with a date and optional location note (F12).
- "In shop now" view with total retail value (F13).
- Pull back to studio; write-off with reason (F14).
- Price change history (F5), since it touches the same edit paths.

**Done when:** you can move a batch of items into the shop and see accurate in-shop lists and totals.

## M5 — Sales and reconciliation
**Goal:** The core workflow: shop report → recorded sales.
- Mark sold with date and price, defaulting to retail; edit and undo (F15).
- ShopReport records (period, received date, reported total).
- Reconciliation flow: create a report period, enter sold items by item number (number pad → photo and price shown → confirm → next), with the in-shop list as a fallback; running count and total versus the reported total (F16, F17).
- Discrepancy flags: unknown item number, sold item not in shop, price differs from retail, duplicate (F18).
- Profit per item (F21).

**Done when:** a sample real report can be reconciled end-to-end in under 5 minutes and the totals match.

## M6 — Dashboard, reports, expenses
**Goal:** See how the business is doing.
- Dashboard: status counts, in-shop value, month and YTD sales and profit, recent activity (F23).
- Expenses: booth rent, fees, other (F22).
- Reports by date range and category, best sellers, average days to sell, net profit after expenses (F24).
- Aging view (F25).
- CSV export of items, sales, expenses (F26).

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
