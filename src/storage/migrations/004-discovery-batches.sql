CREATE TABLE IF NOT EXISTS batch_runs (
  id TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS batch_items (
  batch_id TEXT NOT NULL REFERENCES batch_runs(id) ON DELETE CASCADE,
  item_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  status TEXT NOT NULL,
  result_status TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  discovery_run_id TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (batch_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_batch_items_status
  ON batch_items(batch_id, status, position);
