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
```bash
cp .env.example .env   # set DOMAIN to a hostname pointing at this server
docker compose up -d --build
```
Open `https://<DOMAIN>` on your phone, then Share → Add to Home Screen. Data lives in `./data` (back this up).
