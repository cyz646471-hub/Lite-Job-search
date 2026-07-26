ALTER TABLE career_portals ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'OFFICIAL_SITE';
ALTER TABLE career_portals ADD COLUMN official_identity_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE career_portals ADD COLUMN platform_identity_confirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE career_portals ADD COLUMN hiring_availability TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE career_portals ADD COLUMN fallback_reason TEXT;
ALTER TABLE career_portals ADD COLUMN search_coverage TEXT;
ALTER TABLE career_portals ADD COLUMN superseded_by_portal_id TEXT;
ALTER TABLE career_portals ADD COLUMN last_checked_at TEXT;

UPDATE career_portals
SET source_tier = 'OFFICIAL_ATS'
WHERE ats_type != '';

UPDATE career_portals
SET official_identity_confirmed = 1
WHERE verification_status = 'VERIFIED';

CREATE TABLE IF NOT EXISTS recruitment_events (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  career_portal_id TEXT NOT NULL REFERENCES career_portals(id) ON DELETE CASCADE,
  source_tier TEXT NOT NULL,
  recruitment_type TEXT NOT NULL,
  cohort TEXT,
  campaign_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  start_at TEXT,
  closes_at TEXT,
  directory_url TEXT NOT NULL,
  locations_json TEXT NOT NULL DEFAULT '[]',
  publication_class TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_verified_at TEXT
);

ALTER TABLE job_openings
  ADD COLUMN recruitment_event_id TEXT REFERENCES recruitment_events(id);
ALTER TABLE job_openings
  ADD COLUMN source_tier TEXT NOT NULL DEFAULT 'OFFICIAL_SITE';

CREATE INDEX IF NOT EXISTS idx_events_company ON recruitment_events(company_id);
CREATE INDEX IF NOT EXISTS idx_events_portal ON recruitment_events(career_portal_id);
CREATE INDEX IF NOT EXISTS idx_events_status ON recruitment_events(status);
CREATE INDEX IF NOT EXISTS idx_jobs_event ON job_openings(recruitment_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_identity
  ON recruitment_events(
    company_id,
    recruitment_type,
    COALESCE(cohort, ''),
    directory_url
  );
