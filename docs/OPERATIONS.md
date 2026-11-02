# Store Manager — Operations guide

How to install, update, back up, restore and look after Store Manager. Commands marked **server** run in the app's folder on the host (`<DEPLOY_DIR>`, usually `~/store-manager`); **dev machine** means the Windows PC with Docker Desktop and this repo.

Values in angle brackets, like `<PUBLIC_URL>`, are this site's own settings. They're kept out of the repo; see [Site settings](#site-settings-siteenv).

## How it's put together

- One Docker container (`app`) running Node, serving the web app and its API on plain HTTP port 3000.
- The host's existing reverse proxy (Caddy) provides HTTPS and serves the app at `<PUBLIC_URL>`.
- All data lives in `./data` on the server, mounted at `/data`:

| Path | What |
|---|---|
| `data/store.db` (+ `-wal`, `-shm`) | The database (SQLite) |
| `data/photos/` | Item photos: `<id>.jpg` and `<id>.thumb.jpg` |
| `data/backups/` | Automatic backups (unless `BACKUP_DIR` points elsewhere) |
| `data/pre-restore-*/` | Data set aside by a restore; delete once you're happy |

- The image is **built on the dev machine** and copied to the server. The server's CPU (Pentium G2020T, no AVX) can't run the front-end build tools; it runs the app fine.
- The container runs as uid 1000 with a read-only root filesystem, no Linux capabilities and `no-new-privileges`. It can only write to `/data` and a small `/tmp`.

## Site settings (`site.env`)

This deployment's own hostname, addresses and SSH target are **not committed**. They live in `site.env` in the repo folder on the dev machine, which git ignores. `site.env.example` is the committed template listing every key. The docs refer to these values by name in angle brackets, and `deploy.ps1` reads `DEPLOY_TARGET` and `DEPLOY_DIR` from it.

**If `site.env` is missing** (new PC, fresh clone), run `cp site.env.example site.env` and fill it in:

| Key | What it is | Where to find it if forgotten |
|---|---|---|
| `DEPLOY_TARGET` | SSH target for the server, `user@host` | How you usually SSH to the server, or `~/.ssh/config` |
| `DEPLOY_DIR` | Folder on the server with `docker-compose.yml`, `.env`, `data/` | Usually `~/store-manager` |
| `PUBLIC_URL` | Address you open on the phone, including `/store/` | The Home Screen app's address, or the site block in the server's Caddyfile |
| `SERVER_LAN_IP` | Server's address on the home network | `APP_BIND` in the server's `.env`, or `hostname -I` on the server |
| `APP_PORT` | Host port the app is published on | `APP_PORT` in the server's `.env` |
| `LAN_SUBNET` | Home network range, for the optional LAN-only rule | Router settings, e.g. `192.168.0.0/24` |

These aren't secrets (no passwords or keys), just details of this setup that don't belong in a shared repo. The server's own `.env` (also git-ignored) holds the copies the container actually uses (`APP_BIND`, `APP_PORT`).

## Configuration (`.env`)

| Variable | Read on | Default | Purpose |
|---|---|---|---|
| `BASE_PATH` | dev machine | `/` | URL prefix the proxy serves the app under (`/store/` here). Baked into the build. |
| `APP_BIND` | server | `127.0.0.1` | Address the port is published on. Here: `<SERVER_LAN_IP>`, so the Caddy container can reach it. |
| `APP_PORT` | server | `3000` | Host port. Here: `<APP_PORT>` (3000 is taken by another service on the host). |
| `BACKUP_INTERVAL_HOURS` | server | `24` | Hours between automatic backups. `0` turns them off. |
| `BACKUP_KEEP` | server | `14` | How many backups to keep. |
| `BACKUP_DIR_IN_CONTAINER` | server | *(empty)* | Set to `/backups` after mounting another disk there in `docker-compose.yml`. |

## First install (server)

```bash
mkdir -p ~/store-manager/data && sudo chown 1000:1000 ~/store-manager/data
cd ~/store-manager && cp .env.example .env       # set APP_BIND, APP_PORT
```

Then deploy from the dev machine (next section), and set the password:

```bash
docker compose exec app node server/dist/cli.js set-password
```

Add the proxy route. For Caddy, inside the site's `route` block and before any catch-all:

```
redir /store /store/ 308
handle_path /store/* {
    reverse_proxy <SERVER_LAN_IP>:<APP_PORT>
}
```

Reload Caddy: `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`. Open `<PUBLIC_URL>` on the phone, sign in, then Share → Add to Home Screen.

Other proxy setups (nginx, dedicated hostname, Docker network) are in the README.

## Deploying an update (dev machine, PowerShell)

```bash
.\deploy.ps1
```

The server and folder come from `DEPLOY_TARGET` and `DEPLOY_DIR` in `site.env` (or pass `-Server user@host`). This builds the image, copies it and `docker-compose.yml` to the server, loads it, restarts the container and runs a health check. Database migrations run automatically when the app starts. Before a big update, take a backup first (Settings → Back up now).

Never pipe `docker save` through PowerShell; it corrupts the file. `deploy.ps1` writes to a file instead.

## Backups

### What happens automatically

Every `BACKUP_INTERVAL_HOURS` (default 24), the app saves a backup to `data/backups/<date>_<time>/`:
- `store.db`: a consistent snapshot, checked with SQLite's integrity check.
- `photos/`: the photo files. Unchanged photos are hard-linked to the previous backup, so a daily backup costs little extra disk.
- `manifest.json`: counts and a checksum.

The newest `BACKUP_KEEP` (default 14) are kept. Settings → Backups shows the last backup and warns if they've stopped.

### Keep a copy somewhere else

Backups on the same disk don't survive that disk failing. Do at least one of these:

1. **Download now and then.** Settings → Backups → Download latest saves a `.tar.gz` to your phone or computer (Files / iCloud).
2. **Copy the backups folder off the server** on a schedule, for example to another disk or a synced cloud folder:
   ```bash
   # crontab -e on the server: nightly at 04:00
   0 4 * * * rsync -a --delete ~/store-manager/data/backups/ /mnt/otherdisk/store-manager-backups/
   ```
3. **Point backups at another disk.** In `docker-compose.yml`, uncomment the `/backups` volume line with your disk's path, set `BACKUP_DIR_IN_CONTAINER=/backups` in `.env`, and redeploy. Hard-linking only works within one disk, so on another disk each photo is copied once and then linked between backups there.

### Making one by hand

```bash
docker compose exec app node server/dist/cli.js backup
docker compose exec app node server/dist/cli.js list-backups
```

## Restoring

Restoring replaces **all** current data with the backup's. The current data isn't deleted; it's moved to `data/pre-restore-<time>/` first, so you can go back.

From a backup on the server:

```bash
docker compose exec app node server/dist/cli.js list-backups
docker compose stop app
docker compose run --rm app node server/dist/cli.js restore 2026-10-31_030000
docker compose up -d
```

From a downloaded `.tar.gz` (for example onto a new server after a disk failure):

```bash
# do the First install steps first, then:
cp ~/Downloads/store-manager-backup-2026-10-31_030000.tar.gz ~/store-manager/data/
docker compose stop app
docker compose run --rm app node server/dist/cli.js restore /data/store-manager-backup-2026-10-31_030000.tar.gz
docker compose up -d
```

`restore` shows what's in the backup and asks you to type `RESTORE` (add `--yes` to skip the prompt). It refuses a backup whose checksum, integrity check or photo count doesn't match. A backup from an older version is upgraded automatically on start. You stay signed in on devices only if the backup's sessions are still valid; otherwise sign in again.

**Tested:** in a restore drill with 2,000 items, 1,200 photo files, 800 sales and 24 expenses, a backup was downloaded, the container and its data volume were deleted, and the archive was restored onto a fresh install. The item count, shop value, sales total, net profit and photo files matched exactly.

## Passwords and sign-in

- Set or reset (signs out every device): `docker compose exec app node server/dist/cli.js set-password`.
- Change while signed in: Settings → Password (signs out other devices).
- Lost a phone: Settings → Sign out everywhere, or reset the password.
- After 5 wrong attempts from one address (or 20 overall) in 15 minutes, sign-in is paused for the rest of the 15 minutes.
- Settings → Activity log lists every change and sign-in, including failed attempts with their address.

## Security notes

- Sessions are random tokens in an `HttpOnly`, `SameSite=Lax` cookie, marked `Secure` behind HTTPS, and stored only as hashes. They last 90 days from last use.
- Every write needs a custom request header that other sites can't send (CSRF protection).
- Responses carry a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff` and a same-origin referrer policy. HSTS comes from Caddy.
- Uploads must be JPEGs within size limits; photo and backup names are validated before any file access; CSV exports neutralize spreadsheet formulas.
- To limit access to your home network or VPN, add a matcher in Caddy:
  ```
  @outside not remote_ip <LAN_SUBNET>
  respond @outside 403
  ```
  (This also blocks the phone on cellular unless you're on a VPN.)
- `npm audit` reports moderate advisories in `glob`/`minimatch`, used by `@fastify/static` only to match the app's own fixed file patterns. Request input never reaches them. Recheck when updating dependencies.

## Health and troubleshooting

| Symptom | Cause / fix |
|---|---|
| `curl http://<SERVER_LAN_IP>:<APP_PORT>/api/health` fails | `docker compose ps` and `docker compose logs --tail 50 app`. |
| Container restarts with "Data directory /data is not writable" | `sudo chown -R 1000:1000 ~/store-manager/data` |
| Build fails with "Illegal instruction" on the server | Don't build on the server; use `deploy.ps1` from the dev machine. |
| `invalid tar header` when loading the image | The tar was piped through PowerShell; use `deploy.ps1`. |
| `deploy.ps1` says "No server given" | `site.env` is missing; see [Site settings](#site-settings-siteenv). |
| Page loads but is blank, or assets 404 | `BASE_PATH` in the dev machine's `.env` must match the proxy path (`/store/`), then redeploy. |
| Settings → Backups warns backups may not be running | Check `docker compose logs app \| grep backup`; check disk space (`df -h`). |
| Camera or Add to Home Screen don't work | The site must be opened over HTTPS. |

## Removing old data

- `data/pre-restore-*` folders: delete once a restore is confirmed good.
- Archived items stay in the database (and backups); there's no hard delete in the app.
