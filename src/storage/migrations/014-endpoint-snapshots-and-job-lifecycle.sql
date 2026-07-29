ALTER TABLE source_endpoints ADD COLUMN last_failure_at TEXT;
ALTER TABLE source_endpoints ADD COLUMN last_failure_reason TEXT;
ALTER TABLE source_endpoints ADD COLUMN last_http_status INTEGER;

CREATE TABLE IF NOT EXISTS page_snapshots (
  id TEXT PRIMARY KEY,
  source_endpoint_id TEXT NOT NULL REFERENCES source_endpoints(id) ON DELETE CASCADE,
  observation_id TEXT NOT NULL UNIQUE REFERENCES fetch_observations(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  final_url TEXT,
  content_type TEXT,
  body_path TEXT NOT NULL,
  body_bytes INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL,
  structure_hash TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_page_snapshots_endpoint
  ON page_snapshots(source_endpoint_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_page_snapshots_content
  ON page_snapshots(content_hash, captured_at DESC);

ALTER TABLE job_openings ADD COLUMN consecutive_missing_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE job_openings ADD COLUMN last_present_at TEXT;
ALTER TABLE job_openings ADD COLUMN closed_evidence_json TEXT NOT NULL DEFAULT '[]';

UPDATE job_openings
SET last_present_at = COALESCE(last_present_at, last_seen_at);

ALTER TABLE monitor_policies ADD COLUMN student_interest_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_policies ADD COLUMN historical_application_score REAL NOT NULL DEFAULT 0;
ALTER TABLE monitor_policies ADD COLUMN last_outcome TEXT;
ALTER TABLE monitor_policies ADD COLUMN priority_reasons_json TEXT NOT NULL DEFAULT '[]';
