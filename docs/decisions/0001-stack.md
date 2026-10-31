# ADR 0001 — Technology stack

Status: proposed (M0), 2026-10-30

| Layer | Choice | Why |
|---|---|---|
| Runtime / language | Node 22 + TypeScript | One language across server and client; small image. |
| HTTP server | Fastify 5 | Fast, typed, built-in test injection, serves the static PWA too. |
| Database | SQLite (better-sqlite3), WAL mode | Single user; no DB server; backup = copy one file. |
| Migrations | Plain ordered `.sql` files + tiny runner (`server/src/db.ts`) | No ORM dependency; forward-only, easy to read. |
| Front end | Svelte 5 + Vite | Small bundle, little boilerplate, good for forms/lists on phones. |
| PWA | vite-plugin-pwa (Workbox) | Manifest + service worker for Home Screen install. |
| Tests | Vitest | Same toolchain as Vite; `fastify.inject` for API tests. |
| Packaging | Multi-stage Dockerfile, one container behind the host's existing TLS reverse proxy | The host already terminates TLS; no bundled proxy needed. |

## Notes
- No ORM: the schema is small and SQL is clearer. Revisit if queries sprawl.
- `better-sqlite3` 13 compiles from source, so the Docker build stage installs `python3 make g++`; the runtime stage copies the compiled, pruned `node_modules` and has no toolchain.
- The production server (Pentium G2020T) has no AVX. The front-end build tools crash there with "Illegal instruction", so the image is built on the dev machine and shipped with `deploy.ps1`. The Node runtime and better-sqlite3 run fine on it.
- The app is served under a path prefix (`/store/`) because the host has a single DDNS hostname. `BASE_PATH` is a build-time setting for the web client only; the proxy strips the prefix, so the server is unaware of it.
- `npm audit` flags build-time-only issues via workbox-build (dev dependency, not shipped in the image). For production dependencies it flags `glob`/`minimatch` under `@fastify/static`; they only match the app's fixed file patterns, never request input, and the suggested fix is a three-major-version downgrade, so it's accepted and noted in docs/OPERATIONS.md.
- Audit log (M7): SQLite triggers (migration 008) record every insert, update and delete on the main tables as old/new JSON, so no code path can skip it; the API computes field diffs when reading. Sign-in events are added by the app.
- Backups (M7): `db.backup()` online snapshot plus hard-linked photos, so daily backups are cheap; downloadable as .tar.gz (tar-stream, pure JS). Restore is a CLI step with the app stopped, and it sets the current data aside rather than deleting it.
- All image work happens on the phone (canvas): it decodes the photo once (including HEIC and EXIF rotation) and uploads a ≤ 2000 px JPEG plus a ≤ 480 px thumbnail. The server only validates JPEG structure and dimensions (`server/src/jpeg.ts`) and stores both files. This avoids a native image library (`sharp`/libvips) on the old server CPU and keeps the server's CPU load near zero. Trade-off: the server can't re-generate thumbnails in other sizes; a later one-off script could do that from the full images if needed.
- iOS needs a PNG `apple-touch-icon`; PNG icons are rendered from `web/public/icon.svg` with `npm run icons` (dev machine only) and committed.
