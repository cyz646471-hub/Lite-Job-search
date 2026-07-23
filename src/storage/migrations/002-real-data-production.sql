ALTER TABLE companies ADD COLUMN chinese_name TEXT;
ALTER TABLE companies ADD COLUMN english_name TEXT;
ALTER TABLE companies ADD COLUMN country_region TEXT;

ALTER TABLE career_portals
  ADD COLUMN recruitment_types_json TEXT NOT NULL DEFAULT '[]';
