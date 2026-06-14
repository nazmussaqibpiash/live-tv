-- Cloudflare D1 schema for Live TV source management

CREATE TABLE IF NOT EXISTS channels (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  subcategory   TEXT,
  logo_url      TEXT,
  tvg_id        TEXT,
  country       TEXT,
  is_bdix       INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id                      TEXT PRIMARY KEY,
  channel_id              TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  url                     TEXT NOT NULL UNIQUE,
  source_origin           TEXT,
  protocol                TEXT,
  headers_json            TEXT,
  quality                 TEXT,
  bitrate_kbps            INTEGER,
  is_primary              INTEGER DEFAULT 0,
  rank_score              REAL DEFAULT 0,
  last_check_at           TEXT,
  last_status             TEXT,
  uptime_7d               REAL DEFAULT 0,
  avg_latency_ms          INTEGER,
  playback_success_rate   REAL DEFAULT 1,
  fail_count              INTEGER DEFAULT 0,
  created_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_checks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  checked_at  TEXT NOT NULL,
  status      TEXT NOT NULL,
  latency_ms  INTEGER,
  http_code   INTEGER,
  error_msg   TEXT
);

CREATE TABLE IF NOT EXISTS source_feeds (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  type          TEXT NOT NULL,
  region        TEXT,
  priority      INTEGER DEFAULT 5,
  max_channels  INTEGER,
  last_run_at   TEXT,
  last_status   TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sources_channel ON sources(channel_id);
CREATE INDEX IF NOT EXISTS idx_sources_rank ON sources(channel_id, rank_score DESC);
CREATE INDEX IF NOT EXISTS idx_checks_source ON source_checks(source_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_channels_category ON channels(category, status);
