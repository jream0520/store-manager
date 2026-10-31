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

The container serves plain HTTP on `127.0.0.1:${APP_PORT}` (default 3000). Your existing reverse proxy terminates HTTPS, which iOS requires for the camera and Home Screen install.

```bash
cp .env.example .env               # optional: change APP_PORT
mkdir -p data && sudo chown 1000:1000 data   # container runs as uid 1000
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

Then add a site to your proxy, open `https://<your-hostname>` on the phone, and choose Share → Add to Home Screen. All data lives in `./data` (back it up).

### Reverse proxy examples

Allow uploads of at least 20 MB so photo uploads aren't rejected.

**nginx**
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

**Caddy**
```
store.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

**Proxy running in Docker (Traefik, nginx-proxy, Caddy container):** remove `ports` from `docker-compose.yml`, join the proxy's network, and target `app:3000`:
```yaml
services:
  app:
    networks: [proxy]
networks:
  proxy:
    external: true   # use your proxy's network name
```
