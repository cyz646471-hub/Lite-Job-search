UPDATE job_openings
SET quality_grade = 'B',
    publication_status = 'REVIEW_REQUIRED',
    quality_reasons_json = '["RECRUITMENT_EVENT_MISSING"]'
WHERE quality_grade = 'A'
  AND NOT EXISTS (
    SELECT 1
    FROM recruitment_events AS events
    WHERE events.id = job_openings.recruitment_event_id
      AND events.status = 'OPEN'
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
