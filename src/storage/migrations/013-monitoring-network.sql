CREATE TABLE IF NOT EXISTS source_endpoints (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  career_portal_id TEXT REFERENCES career_portals(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  endpoint_kind TEXT NOT NULL,
  transport TEXT NOT NULL,
  adapter_type TEXT,
  state TEXT NOT NULL,
  interval_hours INTEGER NOT NULL,
  etag TEXT,
  last_modified TEXT,
  content_hash TEXT,
  structure_hash TEXT,
  last_checked_at TEXT,
  last_success_at TEXT,
  next_check_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, canonical_url)
);

CREATE INDEX IF NOT EXISTS idx_source_endpoints_due
  ON source_endpoints(state, next_check_at, company_id);

CREATE INDEX IF NOT EXISTS idx_source_endpoints_adapter
  ON source_endpoints(adapter_type, endpoint_kind, state);

CREATE TABLE IF NOT EXISTS fetch_observations (
  id TEXT PRIMARY KEY,
  source_endpoint_id TEXT NOT NULL REFERENCES source_endpoints(id) ON DELETE CASCADE,
  run_id TEXT,
  fetched_at TEXT NOT NULL,
  outcome TEXT NOT NULL,
  http_status INTEGER,
  final_url TEXT,
  content_hash TEXT,
  structure_hash TEXT,
  page_role TEXT NOT NULL,
  hiring_availability TEXT NOT NULL,
  job_count INTEGER NOT NULL DEFAULT 0,
  reason_code TEXT,
  evidence_json TEXT NOT NULL DEFAULT '[]',
  snapshot_path TEXT,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_fetch_observations_endpoint
  ON fetch_observations(source_endpoint_id, fetched_at DESC);

CREATE INDEX IF NOT EXISTS idx_fetch_observations_outcome
  ON fetch_observations(outcome, fetched_at DESC);

CREATE TABLE IF NOT EXISTS job_revisions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  observation_id TEXT REFERENCES fetch_observations(id) ON DELETE SET NULL,
  revision_hash TEXT NOT NULL,
  change_type TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL DEFAULT '[]',
  observed_at TEXT NOT NULL,
  UNIQUE(job_id, revision_hash, change_type)
);

CREATE INDEX IF NOT EXISTS idx_job_revisions_job
  ON job_revisions(job_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS monitor_policies (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  queue_lane TEXT NOT NULL,
  priority INTEGER NOT NULL,
  schedule_class TEXT NOT NULL,
  interval_hours INTEGER NOT NULL,
  browser_allowed INTEGER NOT NULL DEFAULT 0,
  search_allowed INTEGER NOT NULL DEFAULT 0,
  consecutive_missing_threshold INTEGER NOT NULL DEFAULT 3,
  last_scheduled_at TEXT,
  next_due_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_monitor_policies_due
  ON monitor_policies(enabled, queue_lane, next_due_at, priority DESC);

INSERT OR IGNORE INTO source_endpoints (
  id, company_id, career_portal_id, url, canonical_url, endpoint_kind,
  transport, adapter_type, state, interval_hours, last_checked_at,
  last_success_at, next_check_at, consecutive_failures, metadata_json,
  created_at, updated_at
)
SELECT
  'endpoint-' || substr(lower(hex(randomblob(16))), 1, 24),
  portals.company_id,
  portals.id,
  portals.url,
  portals.canonical_url,
  CASE portals.page_type
    WHEN 'JOB_LIST' THEN 'JOB_LIST'
    WHEN 'CAMPAIGN' THEN 'JOB_LIST'
    ELSE 'CAREER_PORTAL'
  END,
  CASE
    WHEN portals.source_tier = 'OFFICIAL_SOCIAL' THEN 'SOCIAL'
    WHEN portals.ats_type <> '' THEN 'ATS_ADAPTER'
    ELSE 'HTTP'
  END,
  NULLIF(portals.ats_type, ''),
  CASE
    WHEN portals.verification_status = 'BLOCKED' THEN 'BLOCKED'
    ELSE 'ACTIVE'
  END,
  CASE
    WHEN portals.hiring_availability = 'OPENINGS_FOUND' THEN 48
    ELSE 168
  END,
  portals.last_checked_at,
  portals.last_verified_at,
  portals.last_checked_at,
  0,
  '{"migratedFrom":"career_portals"}',
  portals.first_seen_at,
  COALESCE(portals.last_checked_at, portals.first_seen_at)
FROM career_portals AS portals
WHERE portals.superseded_by_portal_id IS NULL
  AND portals.source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL')
  AND portals.verification_status IN ('VERIFIED', 'REVIEW', 'BLOCKED');

INSERT OR IGNORE INTO monitor_policies (
  id, target_type, target_id, queue_lane, priority, schedule_class,
  interval_hours, browser_allowed, search_allowed,
  consecutive_missing_threshold, last_scheduled_at, next_due_at,
  enabled, reason, created_at, updated_at
)
SELECT
  'policy-' || substr(lower(hex(randomblob(16))), 1, 24),
  'SOURCE_ENDPOINT',
  endpoints.id,
  CASE
    WHEN portals.verification_status = 'VERIFIED' THEN 'PORTAL_MONITOR'
    ELSE 'PORTAL_RECOVERY'
  END,
  CASE
    WHEN portals.hiring_availability = 'OPENINGS_FOUND' THEN 90
    ELSE 60
  END,
  CASE
    WHEN portals.hiring_availability = 'OPENINGS_FOUND' THEN 'RECRUITING_SEASON'
    ELSE 'STANDARD'
  END,
  endpoints.interval_hours,
  CASE WHEN portals.verification_status = 'VERIFIED' THEN 0 ELSE 1 END,
  0,
  3,
  NULL,
  endpoints.next_check_at,
  1,
  'migration_from_career_portal',
  endpoints.created_at,
  endpoints.updated_at
FROM source_endpoints AS endpoints
JOIN career_portals AS portals ON portals.id = endpoints.career_portal_id;
