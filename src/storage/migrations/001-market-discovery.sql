PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('CN', 'NA')),
  primary_official_domain TEXT,
  industry_tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (market, canonical_name)
);

CREATE TABLE IF NOT EXISTS company_aliases (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  PRIMARY KEY (company_id, alias)
);

CREATE TABLE IF NOT EXISTS company_domains (
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('CN', 'NA')),
  PRIMARY KEY (company_id, domain),
  UNIQUE (market, domain)
);

CREATE TABLE IF NOT EXISTS career_portals (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL UNIQUE,
  registrable_domain TEXT NOT NULL,
  ats_type TEXT NOT NULL DEFAULT '',
  page_type TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  first_seen_at TEXT NOT NULL,
  last_verified_at TEXT
);

CREATE TABLE IF NOT EXISTS verification_evidence (
  career_portal_id TEXT NOT NULL REFERENCES career_portals(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('POSITIVE', 'NEGATIVE', 'NEUTRAL')),
  weight INTEGER NOT NULL,
  observed_value TEXT,
  source_url TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  PRIMARY KEY (career_portal_id, code, source_url)
);

CREATE TABLE IF NOT EXISTS job_openings (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  career_portal_id TEXT NOT NULL REFERENCES career_portals(id) ON DELETE CASCADE,
  source_job_id TEXT,
  title TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  role_family TEXT NOT NULL,
  locations_json TEXT NOT NULL DEFAULT '[]',
  employment_type TEXT,
  published_at TEXT,
  closes_at TEXT,
  job_detail_url TEXT,
  apply_url TEXT,
  status TEXT NOT NULL,
  source_url TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  intent_json TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS discovery_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES discovery_runs(id) ON DELETE CASCADE,
  search_intent_id TEXT NOT NULL,
  query TEXT NOT NULL,
  expanded_keywords_json TEXT NOT NULL DEFAULT '[]',
  search_source TEXT NOT NULL,
  searched_at TEXT NOT NULL,
  result_url TEXT,
  result_rank INTEGER,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_portals_company ON career_portals(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON job_openings(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_portal ON job_openings(career_portal_id);
CREATE INDEX IF NOT EXISTS idx_jobs_published ON job_openings(published_at);
CREATE INDEX IF NOT EXISTS idx_logs_run ON discovery_logs(run_id);
