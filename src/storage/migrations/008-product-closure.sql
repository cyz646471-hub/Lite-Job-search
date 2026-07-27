ALTER TABLE job_openings ADD COLUMN quality_grade TEXT NOT NULL DEFAULT 'C';
ALTER TABLE job_openings ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'CANDIDATE';
ALTER TABLE job_openings ADD COLUMN quality_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE job_openings ADD COLUMN application_verified_at TEXT;
ALTER TABLE job_openings ADD COLUMN dedupe_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_publication_gate
  ON job_openings(publication_status, quality_grade, status);

CREATE TABLE IF NOT EXISTS review_tasks (
  id TEXT PRIMARY KEY,
  review_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  status TEXT NOT NULL,
  system_decision TEXT,
  ai_advice TEXT,
  reviewer TEXT,
  result TEXT,
  structured_changes_json TEXT NOT NULL DEFAULT '{}',
  reason_codes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_review_tasks_open_target
  ON review_tasks(review_type, target_type, target_id)
  WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS idx_review_tasks_queue
  ON review_tasks(status, review_type, created_at);

CREATE TABLE IF NOT EXISTS job_assignments (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES job_openings(id) ON DELETE CASCADE,
  assignee_type TEXT NOT NULL,
  assignee_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(job_id, assignee_type, assignee_id)
);

CREATE INDEX IF NOT EXISTS idx_job_assignments_assignee
  ON job_assignments(assignee_type, assignee_id, status, assigned_at);

CREATE TABLE IF NOT EXISTS user_actions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  student_id TEXT,
  job_id TEXT REFERENCES job_openings(id) ON DELETE SET NULL,
  action_type TEXT NOT NULL,
  note TEXT,
  triggers_reverification INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_actions_job
  ON user_actions(job_id, created_at);

CREATE INDEX IF NOT EXISTS idx_user_actions_actor
  ON user_actions(actor_id, created_at);

UPDATE job_openings
SET quality_grade = CASE
      WHEN source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS')
       AND status = 'ACTIVE'
       AND EXISTS (
         SELECT 1
         FROM career_portals AS portals
         LEFT JOIN recruitment_events AS events
           ON events.id = job_openings.recruitment_event_id
         WHERE portals.id = job_openings.career_portal_id
           AND portals.verification_status = 'VERIFIED'
           AND portals.official_identity_confirmed = 1
           AND portals.last_verified_at IS NOT NULL
           AND events.id IS NOT NULL
           AND events.status = 'OPEN'
           AND (
             job_openings.apply_url IS NOT NULL
             OR job_openings.job_detail_url IS NOT NULL
             OR events.directory_url IS NOT NULL
           )
           AND (
             job_openings.locations_json NOT IN ('', '[]')
             OR events.locations_json NOT IN ('', '[]')
           )
       )
      THEN 'A'
      WHEN source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS') THEN 'B'
      ELSE 'C'
    END,
    publication_status = CASE
      WHEN source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS')
       AND status = 'ACTIVE'
       AND EXISTS (
         SELECT 1
         FROM career_portals AS portals
         LEFT JOIN recruitment_events AS events
           ON events.id = job_openings.recruitment_event_id
         WHERE portals.id = job_openings.career_portal_id
           AND portals.verification_status = 'VERIFIED'
           AND portals.official_identity_confirmed = 1
           AND portals.last_verified_at IS NOT NULL
           AND events.id IS NOT NULL
           AND events.status = 'OPEN'
           AND (
             job_openings.apply_url IS NOT NULL
             OR job_openings.job_detail_url IS NOT NULL
             OR events.directory_url IS NOT NULL
           )
           AND (
             job_openings.locations_json NOT IN ('', '[]')
             OR events.locations_json NOT IN ('', '[]')
           )
       )
      THEN 'PUBLISHED'
      WHEN status = 'CLOSED' THEN 'EXPIRED'
      WHEN source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS') THEN 'REVIEW_REQUIRED'
      ELSE 'REVIEW_REQUIRED'
    END,
    quality_reasons_json = CASE
      WHEN source_tier = 'PLATFORM_ONLY' THEN '["PLATFORM_ONLY_SOURCE"]'
      WHEN status = 'CLOSED' THEN '["JOB_CLOSED"]'
      WHEN source_tier IN ('OFFICIAL_SITE', 'OFFICIAL_ATS')
        THEN '["MIGRATED_RECORD_REQUIRES_REEVALUATION"]'
      ELSE quality_reasons_json
    END,
    application_verified_at = (
      SELECT portals.last_verified_at
      FROM career_portals AS portals
      WHERE portals.id = job_openings.career_portal_id
    );

INSERT INTO review_tasks (
  id, review_type, target_type, target_id, status, system_decision,
  reason_codes_json, created_at, updated_at
)
SELECT
  lower(hex(randomblob(16))),
  'JOB_PUBLICATION',
  'JOB_OPENING',
  jobs.id,
  'OPEN',
  jobs.publication_status,
  jobs.quality_reasons_json,
  datetime('now'),
  datetime('now')
FROM job_openings AS jobs
WHERE jobs.publication_status = 'REVIEW_REQUIRED'
  AND NOT EXISTS (
    SELECT 1
    FROM review_tasks AS reviews
    WHERE reviews.review_type = 'JOB_PUBLICATION'
      AND reviews.target_type = 'JOB_OPENING'
      AND reviews.target_id = jobs.id
      AND reviews.status = 'OPEN'
  );
