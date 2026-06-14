# Live TV — Complete Product Audit

> Audit date: 2026-06-14  
> Role: Strict Critic / Auditor / Product Reviewer  
> Verdict: **Strong MVP foundation, not yet competitor-grade.**  
> Functional plumbing exists; product experience, reliability loops, and visual polish lag established IPTV/OTT platforms.

---

## Executive Summary

| Dimension | Score (1–10) | Notes |
|-----------|--------------|-------|
| Visual design / polish | 4 | Tokens exist; inconsistent cards, weak hero, emoji labels |
| UX / IA | 5 | Home/Browse blur; mobile nav incomplete; URL desync |
| Player reliability | 6 | HLS failover good; stall recovery, quality pref, cast missing |
| Search / discovery | 6 | Ranked search added; recent searches UI missing |
| EPG | 4 | Now/next MVP only; 336/~15k coverage |
| Accessibility | 5 | Skip link ✓; dialogs, tabs, grid labels weak |
| Performance | 5 | Full 9MB catalog parse per request; fake pagination |
| Pipeline / data | 5 | Works locally; CI validation state not persisted |
| Production readiness | 4 | Open proxy SSRF; report loop dead on serverless |
| Maintainability | 6 | Duplicated worker/Next logic; dead code (D1, playlist) |

**Bottom line:** Do not add features until P0/P1 items below are resolved.

---

## P0 — Ship Blockers (must fix before E2E test)

### UX / Navigation
1. **Mobile Watch tab missing** — player opens but no way back except Home (`live-tv-app.tsx`)
2. **URL doesn't sync with watch state** — share/deep-link broken in-app (`live-tv-app.tsx`)
3. **Desktop browse hides errors** — error UI in hidden aside (`live-tv-app.tsx:594+545`)
4. **Favorites/Live filter on paginated data** — incomplete results (`live-tv-app.tsx:265-273`)
5. **Home API failure → misleading empty** — "run pipeline" instead of error (`home-view.tsx:54-58`)

### Deceptive / Broken Settings
6. **defaultQuality pref unused** — settings lie to user (`store.ts` vs `video-player.tsx`)
7. **layout/sort/recentSearches prefs dead** — stored but never applied

### Accessibility
8. **Settings panel not a dialog** — no focus trap, aria-modal (`settings-panel.tsx`)
9. **Mobile rail favorites invisible** — hover-only star on touch (`channel-card.tsx:76-79`)
10. **Channel grid buttons lack aria-label** (`channel-grid.tsx`)

### Backend / Reliability
11. **CI validation state not persisted** — `.gitignore` blocks `data/pipeline/` (`pipeline.yml`)
12. **Report feedback loop dead in prod** — read-only FS + worker console.log only
13. **Open HLS/playlist proxy** — SSRF + abuse vector (`hls-proxy`, `worker`)

---

## P1 — Foundation Quality (fix before feature work)

### Visual / IA
14. Home shows every category rail — overwhelming, not curated (`api/home/route.ts`)
15. Two card systems (ChannelCard vs ChannelGrid) — inconsistent hierarchy
16. Category bar always visible — competes with home content
17. Weak spotlight hero — logo blur, not editorial (`home-view.tsx`)
18. Emoji in rail labels — informal (`🔴`, `⚡`)
19. Technical stats in header — "15356 total" not user value
20. Generic branding — Sparkles icon, no identity

### Player
21. Always shows "Live" badge regardless of channel status
22. No "Tap to unmute" when autoplay blocked
23. Keyboard conflict: player volume vs spatial nav arrows
24. `onAllSourcesFailed` never wired — no app-level failover UX
25. Network stall watchdog deferred (`NOTES.md`)

### Error / States
26. No `error.tsx` / error boundary — crash = default Next page
27. Invalid watch URL — no `notFound()` (`watch/[id]/page.tsx`)
28. Home loading = spinner only — no skeleton
29. Share clipboard — no confirmation toast
30. favOnly empty — generic message, not "No favorites yet"

### Architecture
31. Full catalog JSON parse per paginated API request (~9MB)
32. Worker search logic duplicated — drift risk (`worker` vs `catalog.ts`)
33. KV not auto-published in CI — edge stale vs Git
34. D1 schema unused — dead weight (`schema.sql`, `wrangler.toml`)
35. Crawl registry not committed in CI (`source-registry.json`)
36. EPG guides-index workflow orphaned (`epg-sync.yml`)

---

## P2 — Competitor Gap (post-foundation)

| Missing | Competitors |
|---------|-------------|
| Full EPG grid | TiviMate, Pluto, YouTube TV |
| Watch tab + mini-player | Spotify, YouTube |
| Recent searches UI | Netflix, YouTube |
| Channel number / zap | TiviMate |
| Cast / AirPlay | All major OTT |
| Continue watching w/ progress | Netflix |
| Legal / disclaimer pages | Pluto, Samsung TV+ |
| Rate limiting | Any public API |
| Parental controls | Family apps |
| Custom playlist mode | IPTV norm (component exists, unwired) |
| Program search | YouTube TV |
| Preview on hover | Netflix |
| Analytics dashboard | Product teams |
| PWA offline strategy | PWAs |

---

## Strengths (keep)

- Design token system (`globals.css`)
- HLS.js failover + source switcher architecture
- Home rails API with seasonal/BDIX support
- Hydration-safe catalog cache pattern
- PiP restore, live drift recovery, mobile pause-on-tab
- Atomic catalog writes + pipeline lock (local)
- Vitest unit tests (search + EPG)
- Self-hosted analytics scaffold

---

## Fix Status (2026-06-14)

### Phase 1 — P0 blockers ✅ (implemented)
- Mobile nav: **Home / Browse / Watch** (reference pattern)
- URL sync: `/watch/:id` on channel select + back/forward sync
- Global **ErrorBanner** (desktop browse errors visible)
- Home API failure → proper error + retry (not "run pipeline")
- `error.tsx` + `watch/[id]/not-found.tsx`
- Favorites filter loads **all IDs** via `/api/channels?ids=`
- Live-only filter uses API `status=active` (not client slice)
- Settings: `role="dialog"`, focus on open, theme `aria-pressed`
- Mobile rail favorites visible on touch
- Grid/card `aria-label="Watch …"`
- **defaultQuality** wired to HLS level selection
- Player: status-aware badge, **Tap to unmute** hint
- HLS + playlist proxy **SSRF block** (private IP/metadata)
- Home: curated max 4 category rails, emoji labels removed, skeleton loading, hero polish

### Phase 2 — P1 foundation ✅ (implemented)
- Unified card system (`channel-poster.tsx`) + EPG badge on rail/grid cards
- Recent searches UI (`SearchInput` dropdown)
- Toast feedback (share, refresh)
- Header stats → user-facing copy ("X channels ready")
- CI validation state persist (`pipeline.yml` commits state/validation/reports)
- Worker HLS manifest rewrite parity (`worker/src/hls-proxy.ts`)
- Rate limiting on write endpoints (`/api/report`, `/api/events`, `/api/hls-proxy`)
- Full visual/brand pass — deferred to post-E2E polish

### Phase 3 — P2 (after E2E test passes)
- Full EPG grid, cast, legal pages, mini-player, sports model


## Files Referenced

| Area | Key paths |
|------|-----------|
| Main shell | `src/components/live-tv-app.tsx` |
| Home | `src/components/home-view.tsx`, `src/app/api/home/route.ts` |
| Player | `src/components/video-player.tsx` |
| Cards | `src/components/channel-card.tsx`, `channel-grid.tsx` |
| Settings | `src/components/settings-panel.tsx`, `src/lib/store.ts` |
| API | `src/app/api/channels/route.ts`, `hls-proxy/route.ts`, `report/route.ts` |
| Pipeline | `pipeline/run-all.ts`, `merge.ts`, `validate-run.ts` |
| Worker | `worker/src/index.ts` |
| CI | `.github/workflows/pipeline.yml`, `ci.yml` |
