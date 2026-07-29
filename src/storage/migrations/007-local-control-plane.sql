ALTER TABLE batch_runs ADD COLUMN stop_requested_at TEXT;
ALTER TABLE batch_runs ADD COLUMN resumed_at TEXT;

ALTER TABLE batch_items ADD COLUMN queue_type TEXT NOT NULL DEFAULT 'LOCAL_OR_DIRECT_VERIFICATION';
ALTER TABLE batch_items ADD COLUMN defer_reason TEXT;

ALTER TABLE provider_circuit_states ADD COLUMN opened_reason TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN open_until TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN manual_action_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_circuit_states ADD COLUMN manual_acknowledged_at TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN probe_owner_id TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN probe_lease_until TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN last_probe_at TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN last_success_at TEXT;
ALTER TABLE provider_circuit_states ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE provider_circuit_states ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

UPDATE provider_circuit_states
SET state = 'OPEN',
    manual_action_required = 1,
    opened_reason = COALESCE(opened_reason, reason_code)
WHERE state = 'PROBE_REQUIRED';

CREATE TABLE IF NOT EXISTS worker_instances (
  instance_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  profile_key TEXT NOT NULL,
  host_name TEXT NOT NULL,
  pid INTEGER NOT NULL,
  process_start_token TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL,
  current_company_id TEXT,
  last_completed_company_id TEXT,
  stop_requested_at TEXT,
  exited_at TEXT,
  exit_code INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_instances_batch
  ON worker_instances(batch_id, state, heartbeat_at);

CREATE TABLE IF NOT EXISTS profile_locks (
  profile_key TEXT PRIMARY KEY,
  lock_id TEXT NOT NULL UNIQUE,
  instance_id TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  profile_real_path TEXT NOT NULL,
  host_name TEXT NOT NULL,
  pid INTEGER NOT NULL,
  process_start_token TEXT NOT NULL,
  started_at TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS company_web_knowledge (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  knowledge_type TEXT NOT NULL,
  value TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  evidence_source TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT,
  expires_at TEXT,
  rejection_reason TEXT,
  UNIQUE(company_id, knowledge_type, value)
);

CREATE INDEX IF NOT EXISTS idx_company_web_knowledge_lookup
  ON company_web_knowledge(company_id, knowledge_type, verification_status);

CREATE TABLE IF NOT EXISTS search_cache (
  cache_key TEXT PRIMARY KEY,
  engine TEXT NOT NULL,
  normalized_query TEXT NOT NULL,
  locale TEXT NOT NULL,
  absolute_date_from TEXT,
  absolute_date_to TEXT,
  strategy_version TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_cache_lookup
  ON search_cache(engine, normalized_query, locale, strategy_version);

CREATE TABLE IF NOT EXISTS control_tasks (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  location TEXT,
  role_keywords_json TEXT NOT NULL,
  industry TEXT,
  absolute_date_from TEXT NOT NULL,
  absolute_date_to TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  selection_mode TEXT NOT NULL,
  target_unit TEXT NOT NULL,
  allow_baidu_fallback INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target
  ON audit_logs(target_type, target_id, created_at);
