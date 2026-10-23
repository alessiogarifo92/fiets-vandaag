-- Device and route schema (docs/architecture.md §3). Times are Unix epoch milliseconds; local dates are
-- YYYY-MM-DD in Europe/Amsterdam. Start and end points of a route are never stored, only the ~1 km cell of
-- its midpoint and its bearing.

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  secret_hash TEXT NOT NULL,
  lang TEXT NOT NULL CHECK (lang IN ('en', 'nl', 'it')),
  push_endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  push_failures INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_push_ok_at INTEGER
);

CREATE TABLE routes (
  id INTEGER PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot IN (1, 2)),
  cell TEXT NOT NULL,
  bearing_deg REAL NOT NULL CHECK (bearing_deg >= 0 AND bearing_deg < 360),
  window_start_min INTEGER NOT NULL,
  window_end_min INTEGER NOT NULL CHECK (window_end_min > window_start_min AND window_end_min - window_start_min <= 180),
  -- Bit (d - 1) set for ISO weekday d: Monday = 1, Sunday = 64.
  weekdays INTEGER NOT NULL CHECK (weekdays BETWEEN 1 AND 127),
  -- NULL: no push for this route.
  notify_min INTEGER CHECK (notify_min IS NULL OR (notify_min BETWEEN 240 AND 720 AND notify_min % 5 = 0)),
  -- Set by the cron (ticket 5); NULL until it schedules the route, and again after every route change.
  next_run_at INTEGER,
  lease_until INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (device_id, slot)
);

CREATE INDEX routes_next_run ON routes (next_run_at) WHERE next_run_at IS NOT NULL;

CREATE TABLE deliveries (
  route_id INTEGER NOT NULL REFERENCES routes (id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'retry', 'sent', 'skipped_late', 'no_data', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  PRIMARY KEY (route_id, local_date)
);

CREATE TABLE weather_cache (
  cell TEXT PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE opens (
  device_id TEXT NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('app', 'notification')),
  PRIMARY KEY (device_id, local_date, source)
);
