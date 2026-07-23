import { normalizeMarket } from '../core/contracts.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

export function createSearchIntent(input = {}, {
  id = input.id,
  now = new Date().toISOString(),
} = {}) {
  const roleType = clean(input.roleType);
  const freshnessDays = Number(input.freshnessDays);
  const targetCount = Number(input.targetCount);
  if (!id) throw new Error('SearchIntent id is required');
  if (!roleType) throw new Error('roleType is required');
  if (!Number.isInteger(freshnessDays) || freshnessDays < 1 || freshnessDays > 365) {
    throw new Error('freshnessDays must be an integer between 1 and 365');
  }
  if (!Number.isInteger(targetCount) || targetCount < 1 || targetCount > 1000) {
    throw new Error('targetCount must be an integer between 1 and 1000');
  }
  const market = normalizeMarket(input.market);
  return Object.freeze({
    id: String(id),
    market,
    roleType,
    industryTags: Object.freeze(uniqueStrings(input.industryTags)),
    location: clean(input.location) || null,
    freshnessDays,
    targetCount,
    locale: clean(input.locale) || (market === 'CN' ? 'zh-CN' : 'en-US'),
    createdAt: input.createdAt || now,
  });
}
