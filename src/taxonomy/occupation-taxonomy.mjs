import { readFileSync } from 'node:fs';

const TAXONOMY = Object.freeze(JSON.parse(readFileSync(
  new URL('../../config/occupation-taxonomy.json', import.meta.url),
  'utf8',
)));

function normalize(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function unique(values) {
  return Object.freeze([...new Set(values.filter(Boolean))]);
}

export function resolveOccupationTaxonomy({
  roleType = '',
  industryTags = [],
} = {}) {
  const normalizedRole = normalize(roleType);
  const family = TAXONOMY.families.find((item) => (
    item.match.some((term) => normalizedRole.includes(normalize(term)))
  ));
  const normalizedIndustries = industryTags.map(normalize);
  const industries = TAXONOMY.industries.filter((item) => (
    item.match.some((term) => normalizedIndustries.some((tag) => tag.includes(normalize(term))))
  ));
  return Object.freeze({
    version: TAXONOMY.version,
    roleFamily: family?.id || 'OTHER',
    chineseTerms: unique([roleType, ...(family?.chineseTerms || [])]),
    englishTerms: unique(family?.englishTerms || []),
    synonyms: unique(family?.synonyms || []),
    exclusions: unique(TAXONOMY.globalExclusions || []),
    industryTerms: unique(industries.flatMap((item) => item.terms || [])),
  });
}
