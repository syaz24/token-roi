/**
 * Migrations are plain, ordered, idempotent SQL statements applied inside a
 * transaction and recorded in `_migrations`. Kept hand-written (rather than
 * drizzle-kit generated) so `npm run db:migrate` has zero extra tooling
 * requirements and can also run inside the app on first boot.
 */
export type Migration = { id: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: '0001_init',
    sql: `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  path_norm TEXT NOT NULL,
  git_root TEXT,
  remote_url TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  category TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  started_at TEXT,
  value_method TEXT NOT NULL DEFAULT 'manual',
  tags TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  dataset TEXT NOT NULL DEFAULT 'real',
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_path_norm_dataset_uq ON projects(path_norm, dataset);
CREATE INDEX IF NOT EXISTS projects_dataset_idx ON projects(dataset, archived);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_version TEXT,
  session_id TEXT NOT NULL,
  turn_id TEXT,
  timestamp TEXT NOT NULL,
  working_directory TEXT,
  detected_project_root TEXT,
  project_id TEXT,
  mapping_method TEXT,
  provider TEXT,
  model TEXT,
  model_alias TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_write_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  reported_cost_usd REAL,
  calculated_cost_usd REAL,
  priced INTEGER NOT NULL DEFAULT 0,
  pricing_id TEXT,
  request_type TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  duration_ms INTEGER,
  prompt_preview TEXT,
  metadata TEXT,
  source_file TEXT,
  source_line INTEGER,
  dataset TEXT NOT NULL DEFAULT 'real',
  imported_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS events_ts_idx ON events(dataset, timestamp);
CREATE INDEX IF NOT EXISTS events_project_idx ON events(dataset, project_id, timestamp);
CREATE INDEX IF NOT EXISTS events_model_idx ON events(dataset, model);
CREATE INDEX IF NOT EXISTS events_source_idx ON events(dataset, source);
CREATE INDEX IF NOT EXISTS events_session_idx ON events(session_id);

CREATE TABLE IF NOT EXISTS scan_checkpoints (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  file_path TEXT NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0,
  mtime_ms REAL NOT NULL DEFAULT 0,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT,
  last_line INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE UNIQUE INDEX IF NOT EXISTS scan_ckpt_uq ON scan_checkpoints(source, file_path);

CREATE TABLE IF NOT EXISTS scan_runs (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  files_scanned INTEGER NOT NULL DEFAULT 0,
  records_added INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_skipped INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warnings TEXT NOT NULL DEFAULT '[]',
  errors TEXT NOT NULL DEFAULT '[]',
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  root_path TEXT,
  status TEXT NOT NULL DEFAULT 'detected',
  last_scan_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS pricing (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  input_per_mtok REAL NOT NULL DEFAULT 0,
  output_per_mtok REAL NOT NULL DEFAULT 0,
  cache_read_per_mtok REAL NOT NULL DEFAULT 0,
  cache_write_per_mtok REAL NOT NULL DEFAULT 0,
  reasoning_per_mtok REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  source_note TEXT,
  user_override INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (current_timestamp)
);
CREATE INDEX IF NOT EXISTS pricing_model_idx ON pricing(model_id, effective_from);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  plan_name TEXT NOT NULL,
  monthly_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_start TEXT NOT NULL,
  billing_end TEXT,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  seats INTEGER NOT NULL DEFAULT 1,
  tax_pct REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  allocation_method TEXT NOT NULL DEFAULT 'token_share',
  allocation_config TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  dataset TEXT NOT NULL DEFAULT 'real'
);

CREATE TABLE IF NOT EXISTS value_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  value_type TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  recurrence_period TEXT,
  recurrence_end TEXT,
  realised INTEGER NOT NULL DEFAULT 1,
  confidence TEXT NOT NULL DEFAULT 'medium',
  description TEXT,
  note TEXT,
  evidence_ref TEXT,
  dataset TEXT NOT NULL DEFAULT 'real'
);
CREATE INDEX IF NOT EXISTS value_project_idx ON value_events(dataset, project_id, date);

CREATE TABLE IF NOT EXISTS git_metrics (
  project_id TEXT PRIMARY KEY,
  commit_count INTEGER NOT NULL DEFAULT 0,
  active_days INTEGER NOT NULL DEFAULT 0,
  branches INTEGER NOT NULL DEFAULT 0,
  lines_added INTEGER NOT NULL DEFAULT 0,
  lines_removed INTEGER NOT NULL DEFAULT 0,
  files_changed INTEGER NOT NULL DEFAULT 0,
  contributors INTEGER NOT NULL DEFAULT 0,
  first_commit_at TEXT,
  last_commit_at TEXT,
  commits_by_day TEXT NOT NULL DEFAULT '{}',
  scanned_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mapping_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'prefix',
  project_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (current_timestamp)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];
