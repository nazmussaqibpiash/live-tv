# Live TV — Deploy Guide

Personal automated IPTV platform: GitHub Actions pipeline + Next.js web + Cloudflare Workers API.

## 1. GitHub (pipeline automation)

1. Push this repo to GitHub.
2. Enable **Actions** → workflow **IPTV Pipeline** runs every 6 hours (or trigger manually).
3. First run generates `public/data/catalog.json` with validated channels.
4. Web app reads this file via `/api/channels`.

## 2. Local pipeline test

```bash
npm install
npm run pipeline:all
npm run dev
```

Environment variables:

- `MAX_VALIDATE=200` — limit URLs checked (faster local test)
- `VALIDATE_CONCURRENCY=20`
- `PIPELINE_STEP=discover|validate|merge|all`

## 3. Cloudflare Workers API

### Create resources

```bash
npm install
npx wrangler login
npx wrangler kv namespace create CATALOG
npx wrangler d1 create live-tv
```

Copy IDs into `wrangler.toml` (replace `REPLACE_WITH_*`).

### Apply D1 schema

```bash
npx wrangler d1 execute live-tv --file=schema.sql
```

### Publish catalog (+ EPG) to KV

```bash
npm run pipeline:all          # builds catalog.json and (best-effort) epg.json
npm run pipeline:publish-kv   # writes kv-bulk.json incl. epg:v1 if present
npx wrangler kv bulk put public/data/kv-bulk.json --binding=CATALOG
```

The worker serves `/api/channels` (relevance-ranked + fuzzy search, in sync with
the Next.js API) and `/api/epg?ids=...` (now/next guide) from KV.

### Deploy worker

```bash
npm run worker:deploy
```

Note your worker URL: `https://live-tv-api.<account>.workers.dev`

## 4. Web UI deploy

### Vercel (simplest)

1. Import GitHub repo on Vercel.
2. Set `NEXT_PUBLIC_WORKER_URL` = worker URL (optional).

### Cloudflare Pages

Connect GitHub repo with build command `npm run build`.

## 5. HLS proxy (optional)

1. Set `HLS_PROXY_ENABLED = "true"` in `wrangler.toml`
2. Set `NEXT_PUBLIC_HLS_PROXY_URL=https://...workers.dev/api/hls-proxy`
3. Redeploy worker + web app.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Empty channel list | Run `npm run pipeline:all` or GitHub Action |
| All streams fail | Source switcher; enable HLS proxy |
| Worker 503 | Run publish-kv + kv bulk put |
