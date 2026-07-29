ALTER TABLE career_portals
  ADD COLUMN channel_type TEXT NOT NULL DEFAULT 'WEB_PORTAL';
ALTER TABLE career_portals
  ADD COLUMN official_account_name TEXT;
ALTER TABLE career_portals
  ADD COLUMN official_account_id TEXT;
ALTER TABLE career_portals
  ADD COLUMN verified_subject TEXT;

UPDATE career_portals
SET channel_type = 'ATS'
WHERE source_tier = 'OFFICIAL_ATS' OR ats_type != '';

UPDATE career_portals
SET verification_status = 'REVIEW',
    last_verified_at = NULL
WHERE verification_status = 'VERIFIED'
  AND page_type = 'CAREER_HOME'
  AND hiring_availability = 'UNKNOWN'
  AND NOT EXISTS (
    SELECT 1
    FROM verification_evidence AS evidence
    WHERE evidence.career_portal_id = career_portals.id
      AND evidence.code IN (
        'apply_action',
        'official_site_backlink',
        'official_site_confirms_ats_tenant',
        'reviewed_ats_tenant_ownership',
        'legal_entity_match',
        'official_announcement_lists_url',
        'career_page_identity',
        'wechat_verified_subject_match',
        'official_site_confirms_wechat_account'
      )
  );

UPDATE job_openings
SET quality_grade = 'B',
    publication_status = 'REVIEW_REQUIRED',
    quality_reasons_json = '["CAREER_PORTAL_ROLE_RECHECK_REQUIRED"]'
WHERE career_portal_id IN (
  SELECT id
  FROM career_portals
  WHERE verification_status != 'VERIFIED'
);

CREATE INDEX IF NOT EXISTS idx_portals_channel_type
  ON career_portals(channel_type);
CREATE INDEX IF NOT EXISTS idx_portals_official_account
  ON career_portals(official_account_id);
