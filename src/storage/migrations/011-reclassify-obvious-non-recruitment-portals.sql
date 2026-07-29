INSERT INTO verification_evidence (
  career_portal_id, code, direction, weight, observed_value, source_url, observed_at
)
SELECT id, 'error_page_url', 'NEGATIVE', -100, canonical_url, canonical_url, CURRENT_TIMESTAMP
FROM career_portals
WHERE canonical_url LIKE 'https://404.%'
   OR canonical_url LIKE '%/404.html%'
   OR canonical_url LIKE '%/not-found%'
   OR canonical_url LIKE '%/antibot/%'
   OR canonical_url LIKE '%/verifycode%';

INSERT INTO verification_evidence (
  career_portal_id, code, direction, weight, observed_value, source_url, observed_at
)
SELECT id, 'content_article_page', 'NEGATIVE', -70, canonical_url, canonical_url, CURRENT_TIMESTAMP
FROM career_portals
WHERE canonical_url LIKE 'https://36kr.com/p/%'
   OR canonical_url LIKE 'https://36kr.com/topics/%';

UPDATE career_portals
SET verification_status = 'REJECTED',
    confidence_score = 0,
    page_type = 'UNKNOWN',
    hiring_availability = 'UNKNOWN',
    official_identity_confirmed = 0,
    last_verified_at = NULL
WHERE canonical_url LIKE 'https://404.%'
   OR canonical_url LIKE '%/404.html%'
   OR canonical_url LIKE '%/not-found%'
   OR canonical_url LIKE '%/antibot/%'
   OR canonical_url LIKE '%/verifycode%'
   OR canonical_url LIKE 'https://36kr.com/p/%'
   OR canonical_url LIKE 'https://36kr.com/topics/%'
   OR canonical_url IN (
     'https://51cto.com/',
     'https://www.51cto.com/',
     'http://www.3songshu.com/',
     'https://www.3songshu.com/'
   );

UPDATE job_openings
SET quality_grade = 'B',
    publication_status = 'REVIEW_REQUIRED',
    quality_reasons_json = '["CAREER_PORTAL_RECLASSIFIED_NON_RECRUITMENT"]'
WHERE career_portal_id IN (
  SELECT id FROM career_portals WHERE verification_status != 'VERIFIED'
);
