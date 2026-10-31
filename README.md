# Store Manager

Self-hosted inventory and sales tracker for a booth in a boutique shop. See [PRD.md](PRD.md) and [MILESTONES.md](MILESTONES.md); stack rationale in [docs/decisions/0001-stack.md](docs/decisions/0001-stack.md).

## Develop
```bash
npm install
npm run dev:server   # API on :3000 (data in ./data)
npm run dev:web      # Vite on :5173, proxies /api
npm test
```

## Deploy

The image is **built on the dev machine and loaded on the server**. The server never builds it: the front-end build tools need AVX, which the server's CPU (Pentium G2020T) lacks. The app itself runs fine there.

The container serves plain HTTP. The host's existing reverse proxy terminates HTTPS, which iOS requires for the camera and Home Screen install.

### Configuration (`.env`, see `.env.example`)

| Variable | Read on | Purpose |
|---|---|---|
| `BASE_PATH` | dev machine (build) | URL prefix the proxy serves the app under, e.g. `/store/`. Use `/` for a dedicated hostname. Baked into the web build. |
| `APP_BIND` | server | Address the container is published on. `127.0.0.1` for a proxy on the host; the LAN IP if the proxy reaches services that way. |
| `APP_PORT` | server | Host port the proxy forwards to. |
| `SPIKE_UPLOAD_KEY` | server | Temporary (M1): enables the photo-upload test. Unset to disable. |

### First-time server setup
```bash
mkdir -p ~/store-manager/data && sudo chown 1000:1000 ~/store-manager/data   # container runs as uid 1000
cd ~/store-manager && cp .env.example .env    # then set APP_BIND / APP_PORT
```

### Each deploy (from the dev machine, PowerShell)
```bash
.\deploy.ps1 -Server <DEPLOY_TARGET>
```
This builds the image, writes it to a file, copies it and `docker-compose.yml` to the server, then loads it, restarts the container, and runs a health check. Don't pipe `docker save` through PowerShell, which corrupts the tar.

Then open `https://<your-hostname><BASE_PATH>` on the phone and choose Share → Add to Home Screen. All data lives in `./data` on the server (back it up).

### M1 device check (temporary)

The home page is a device test: server status, Home Screen launch, service worker, storage, and camera → resize → upload → display. Uploads need a shared key because there's no login until M2.

1. On the server, set `SPIKE_UPLOAD_KEY` in `.env` to a long random value (`openssl rand -hex 16`), then run `docker compose up -d --no-build`.
2. On the iPhone in Safari, open the app, enter the key, then take a photo and pick one from the library. Check that they appear upright and that the sizes look sensible.
3. Choose Share → Add to Home Screen, then launch from the icon. "Launched from Home Screen" should say yes, and the service worker should be active. Background the app, reopen it, and check that the launch count increases.
4. When done, clear `SPIKE_UPLOAD_KEY` (this disables the endpoints) and delete `data/spike-photos/`.

### Reverse proxy examples

Allow uploads of at least 20 MB so photo uploads aren't rejected.

**Caddy, path-based (current setup: `BASE_PATH=/store/`).** Inside a `route` block, place this before any catch-all `reverse_proxy`:
```
redir /store /store/ 308
handle_path /store/* {
    reverse_proxy <SERVER_LAN_IP>:<APP_PORT>
}
```
`handle_path` strips `/store` before forwarding, so the server always sees paths from `/`.

**Caddy, dedicated hostname (`BASE_PATH=/`)**
```
store.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**nginx, dedicated hostname**
```nginx
server {
    server_name store.example.com;
    client_max_body_size 20m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # listen 443 ssl; + certificate lines as for your other sites
}
```

**Proxy on a Docker network:** remove `ports` from `docker-compose.yml`, join the proxy's network, and target `app:3000`:
```yaml
services:
  app:
    networks: [proxy]
networks:
  proxy:
    external: true   # use your proxy's network name
```
