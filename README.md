<div align="center">

# 📺 Live TV

**A self-maintaining, competitor-grade live TV streaming platform that never goes stale.**

[![CI](https://github.com/nazmussaqibpiash/live-tv/actions/workflows/ci.yml/badge.svg)](https://github.com/nazmussaqibpiash/live-tv/actions/workflows/ci.yml)
[![Pipeline](https://github.com/nazmussaqibpiash/live-tv/actions/workflows/pipeline.yml/badge.svg)](https://github.com/nazmussaqibpiash/live-tv/actions/workflows/pipeline.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)

🔄 **Auto-updating 24/7** &nbsp;•&nbsp; ⚡ **Best stream auto-selected** &nbsp;•&nbsp; 🧹 **Only fresh & live links**

[🎯 Quick Start](#-quick-start) • [✨ Features](#-features) • [🏗️ Architecture](#️-architecture) • [📖 Docs](#-documentation) • [🤝 Contributing](#-contributing)

</div>

---

## 🌟 Why this project?

Most public IPTV lists rot fast — links die, geo-blocks creep in, and the viewer is left staring at a spinner. **Live TV** solves this with a fully automated freshness loop: a GitHub Actions pipeline continuously discovers new sources, validates every stream, drops dead links, and ranks the survivors by speed — so the app only ever shows channels that actually play.

<table>
<tr>
<td width="50%" valign="top">

### 🔄 Self-Maintaining
- **Auto-discovery** of new IPTV sources from public aggregators
- **Continuous validation** — every live link re-checked each run
- **Dead-link pruning** — broken sources removed automatically
- **No manual upkeep** — runs every 3 hours, forever

</td>
<td width="50%" valign="top">

### ⚡ Built for Quality
- **Speed-ranked sources** — fastest stream selected by default
- **Automatic failover** — falls back to next source on error
- **HLS adaptive playback** powered by `hls.js`
- **EPG now/next** program guide on channel cards

</td>
</tr>
<tr>
<td width="50%" valign="top">

### 🎨 Polished UX
- Unified channel cards, rails & grid
- Instant fuzzy search with recent history
- Deep-linkable `/watch/:id` routes
- Favorites, toasts, graceful error states

</td>
<td width="50%" valign="top">

### 🛡️ Production-Ready
- Edge-hosted API on **Cloudflare Workers**
- KV-backed catalog + EPG for low latency
- Memoized catalog index (15 MB handled fast)
- CI: lint, typecheck, unit tests on every push

</td>
</tr>
</table>

---

## 🎯 Quick Start

```bash
# 1. Clone & install
git clone https://github.com/nazmussaqibpiash/live-tv.git
cd live-tv
npm install

# 2. Build a channel catalog (validates real streams)
npm run pipeline:all

# 3. Run the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and start watching.

> 💡 First pipeline run can take a while as it validates live streams. Speed it up locally with `MAX_VALIDATE=200 npm run pipeline:all`.

---

## ✨ Features

### Playback
- 🎬 **Adaptive HLS streaming** with automatic quality selection
- 🔁 **Multi-source failover** — if one link fails, the next best plays instantly
- ⚡ **Speed-first ranking** — lowest-latency source selected by default
- 📊 **Live status badges** — `Live` / `Unstable` / `Offline` per channel

### Discovery & Browse
- 🔍 **Fuzzy search** with recent-search history
- 🗂️ **Categories & curated rails** on a fast home view
- ⭐ **Favorites** with persistent preferences
- 🔗 **Deep links** — shareable `/watch/:id` URLs

### Self-Maintenance Pipeline
- 🕸️ **Crawl** — auto-discovers new M3U sources
- ✅ **Validate** — probes every URL for liveness, latency & geo-status
- 🧬 **Merge** — dedupes, categorizes, ranks, and drops reported-dead links
- 📅 **EPG** — generates now/next program data
- ☁️ **Publish** — pushes catalog + EPG to Cloudflare KV

---

## 🏗️ Architecture

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────┐
│  GitHub Actions │      │   Cloudflare Worker  │      │   Next.js App   │
│   (pipeline)    │      │      (edge API)      │      │   (frontend)    │
│                 │      │                      │      │                 │
│  crawl ──────►  │      │  /api/channels       │ ◄──► │  Home / Browse  │
│  validate ───►  │ ───► │  /api/epg            │      │  Player /watch  │
│  merge ──────►  │  KV  │  /api/hls-proxy      │      │  Search / Favs  │
│  epg ────────►  │      │                      │      │                 │
│  publish-kv ─►  │      └──────────────────────┘      └─────────────────┘
│                 │
│  every 3 hours  │
└─────────────────┘
```

### Project Structure

```
live-tv/
├── src/
│   ├── app/                 # Next.js App Router (pages + API routes)
│   │   └── api/             # /channels, /home, /epg endpoints
│   ├── components/          # Player, cards, rails, search, layout
│   └── lib/                 # Catalog index, hooks, prefs store
├── pipeline/                # Self-maintenance automation
│   ├── crawl.ts             # Auto-discover new sources
│   ├── discover.ts          # Parse M3U playlists
│   ├── validate-run.ts      # Stream liveness + latency checks
│   ├── merge.ts             # Dedupe, rank, drop dead links
│   ├── epg.ts               # Program guide generation
│   └── publish-kv.ts        # Prepare Cloudflare KV bulk upload
├── worker/                  # Cloudflare Worker (edge API)
├── .github/workflows/       # CI + scheduled pipeline
└── docs/                    # Deploy guide, audit, notes
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 16 (App Router), React 19, Tailwind CSS 4 |
| **State** | Zustand |
| **Playback** | hls.js, `@tanstack/react-virtual` |
| **Edge API** | Cloudflare Workers + KV + D1 |
| **Automation** | GitHub Actions, TypeScript pipeline (`tsx`) |
| **Quality** | ESLint, Vitest |

---

## 📜 Available Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run lint` | Lint the codebase |
| `npm run test` | Run unit tests (Vitest) |
| `npm run pipeline:all` | Run the full crawl → validate → merge → epg pipeline |
| `npm run pipeline:validate` | Validate stream liveness only |
| `npm run pipeline:publish-kv` | Build the KV bulk upload file |
| `npm run worker:dev` | Run the Cloudflare Worker locally |
| `npm run worker:deploy` | Deploy the Worker |

---

## 📖 Documentation

| Guide | Description |
|-------|-------------|
| [🚀 Deploy Guide](docs/DEPLOY.md) | Full Cloudflare + GitHub Actions setup |
| [🔍 Product Audit](docs/AUDIT.md) | Quality assessment & roadmap |
| [📝 Backlog Notes](docs/NOTES.md) | Deferred edge cases & internal notes |
| [🤝 Contributing](CONTRIBUTING.md) | How to contribute |
| [🔒 Security](SECURITY.md) | Reporting vulnerabilities |

---

## 🤝 Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md) before submitting a pull request.

- 🐛 [Report a bug](https://github.com/nazmussaqibpiash/live-tv/issues/new?template=bug_report.md)
- ✨ [Request a feature](https://github.com/nazmussaqibpiash/live-tv/issues/new?template=feature_request.md)

---

## ⚖️ Legal

This project is a **technical demonstration** of an automated streaming aggregator. It does **not** host, store, or distribute any media content — it only indexes publicly available stream URLs. Users are responsible for ensuring their use complies with local laws and the terms of service of any content they access.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

---

<div align="center">

**⭐ If this project is useful to you, please give it a star!**

Made with ❤️ and a relentless freshness loop.

</div>
