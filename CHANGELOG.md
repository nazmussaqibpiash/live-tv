# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Professional repository documentation: README, LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates.

## [0.2.0] - 2026-06-14

### Added
- Self-maintained freshness loop: continuous re-validation of all live catalog URLs each pipeline run.
- Auto-discovery crawler with dead-feed pruning (`deadStreak` tracking).
- Speed-ranked source selection — fastest stream chosen by default with automatic failover.
- EPG now/next program guide with shared client-side cache and request deduplication.
- Unified channel card system across rails and grid.
- Fuzzy search with recent-search history and toast notifications.
- Cloudflare Worker edge API (`/api/channels`, `/api/epg`, HLS proxy) backed by KV.

### Changed
- Catalog filtering now uses a memoized `WeakMap` index for fast handling of the large catalog.
- Home rails are memoized per catalog object to avoid recomputation on every request.
- Channel switching uses shallow `history.pushState` navigation to eliminate the home-page flash.

### Fixed
- Player remount/re-render loops caused by unstable effect dependencies.
- Sources with two or more reported playback failures are now dropped from the catalog.

## [0.1.0] - 2026-06-01

### Added
- Initial Next.js app, basic catalog, and IPTV pipeline scaffold.

[Unreleased]: https://github.com/nazmussaqibpiash/live-tv/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/nazmussaqibpiash/live-tv/releases/tag/v0.2.0
[0.1.0]: https://github.com/nazmussaqibpiash/live-tv/releases/tag/v0.1.0
