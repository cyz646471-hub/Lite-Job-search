UPDATE career_portals
SET verification_status = 'REJECTED',
    confidence_score = 0,
    page_type = 'CORPORATE_HOME',
    hiring_availability = 'UNKNOWN',
    official_identity_confirmed = 0,
    last_verified_at = NULL
WHERE canonical_url IN (
  'https://gz.58.com/',
  'https://www.360.cn/',
  'https://www.qiniu.com/'
);

UPDATE job_openings
SET quality_grade = 'B',
    publication_status = 'REVIEW_REQUIRED',
    quality_reasons_json = '["CORPORATE_HOME_IS_NOT_A_RECRUITMENT_ENTRY"]'
WHERE career_portal_id IN (
  SELECT id
  FROM career_portals
  WHERE canonical_url IN (
    'https://gz.58.com/',
    'https://www.360.cn/',
    'https://www.qiniu.com/'
  )
);
