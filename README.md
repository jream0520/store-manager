# Store Manager

Self-hosted inventory and sales tracker for a booth in a boutique shop: items with photos and tag numbers, what's in the shop, sales reconciled against the shop's reports, expenses and profit. Runs as one Docker container; used from an iPhone as a Home Screen web app.

See [PRD.md](PRD.md), [MILESTONES.md](MILESTONES.md), [docs/OPERATIONS.md](docs/OPERATIONS.md), and the stack rationale in [docs/decisions/0001-stack.md](docs/decisions/0001-stack.md).

## Develop
```bash
npm install
npm run dev:server   # API on :3000 (data in ./data)
npm run dev:web      # Vite on :5173, proxies /api
npm test
```

## Deploy and operate

See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for install, configuration, updates with `deploy.ps1`, backups and restore, passwords, security notes and troubleshooting.

Quick reference (server, in `~/store-manager`):
```bash
docker compose exec app node server/dist/cli.js set-password
docker compose exec app node server/dist/cli.js backup
docker compose exec app node server/dist/cli.js list-backups
```

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
