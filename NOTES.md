# Backlog & Deferred Notes

Internal working notes. Not user-facing docs.

## Deferred player edge cases (handle later)

These were identified during the UI/UX hardening pass and intentionally
deferred per product decision (focus on remaining roadmap first):

- [ ] **Network drop → stall auto-recover.** Add a buffer/stall watchdog: if
      `video.currentTime` stops advancing while `readyState` is low for N
      seconds, call `hls.startLoad()` / nudge `currentTime` to recover instead
      of showing a hard error.
- [ ] **Autoplay-blocked graceful UX.** Muted fallback already exists; add an
      explicit "Tap to unmute" affordance when we had to start muted due to
      browser autoplay policy.
- [ ] **Same-channel re-select guard.** Selecting the channel that is already
      playing should be a no-op (don't tear down + reload HLS).
- [ ] **Fullscreen + orientation lock (mobile).** On fullscreen, attempt
      `screen.orientation.lock('landscape')`; unlock on exit.
- [ ] **Persistent mini-player (Spotify-style).** Premium alternative to the
      current "pause when leaving watch tab" behavior — keep playing in a small
      docked player while browsing other tabs.
- [ ] **Buffering/“Not 24/7” channel messaging.** Distinguish "stream offline"
      vs "temporarily buffering" vs "geo-blocked" with clearer copy.
- [ ] **Source auto-failover on fatal error.** When a source fails fatally,
      auto-advance to the next backup source before surfacing an error.
- [ ] **Keyboard/remote: Back exits player to previous view (TV).**

## Deferred features (from roadmap)

- [ ] **DUDU-style sports event model** — Live & Upcoming match cards, per-event
      multiple servers, HOT badge. Separate phase (the only remaining roadmap item).
- [x] **EPG now/next program guide** (s5) — MVP done (pipeline/epg.ts +
      /api/epg + now-playing block). Follow-up: full time-grid guide, wider
      coverage (more sources / name-based matching), per-card now badge.
- [x] **Cloudflare deploy** (s6) — worker code parity done (ranked+fuzzy search,
      /api/epg, /api/events; publish-kv pushes epg:v1; DEPLOY.md updated;
      `wrangler deploy --dry-run` green). Remaining: actual `wrangler login` +
      real KV/D1 IDs + deploy (needs the user's Cloudflare account).
- [x] **Analytics + error monitoring** (s7) — self-hosted: /api/events + client
      track() beacon (channel_play, play_error, source_switch, search, app_open);
      playback failures already feed /api/report → pipeline auto-demote.
- [ ] **P1 polish** — i18n, rate-limit, legal/disclaimer pages.
- [x] **Tests + tech debt** (s9) — vitest unit tests (catalog search ranking +
      epg nowNext, 10 passing); atomic catalog writes (temp+rename); pipeline
      run lock (race guard); CI workflow (lint/typecheck/test/build).
