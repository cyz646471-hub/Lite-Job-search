import { normalizeMarket } from '../core/contracts.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function normalizeDomain(value) {
  const input = clean(value).toLowerCase();
  if (!input) return '';
  try {
    const url = input.includes('://') ? new URL(input) : new URL(`https://${input}`);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    throw new Error(`invalid official domain: ${value}`);
  }
}

export function createCompany(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const canonicalName = clean(input.canonicalName);
  if (!input.id || !canonicalName) throw new Error('Company id and canonicalName are required');
  const officialDomains = [...new Set((input.officialDomains || []).map(normalizeDomain).filter(Boolean))];
  const explicitPrimary = normalizeDomain(input.primaryOfficialDomain);
  const primaryOfficialDomain = explicitPrimary || officialDomains[0] || null;
  if (primaryOfficialDomain && !officialDomains.includes(primaryOfficialDomain)) {
    officialDomains.unshift(primaryOfficialDomain);
  }
  return Object.freeze({
    id: String(input.id),
    canonicalName,
    aliases: Object.freeze(uniqueStrings(input.aliases)),
    primaryOfficialDomain,
    officialDomains: Object.freeze(officialDomains),
    industryTags: Object.freeze(uniqueStrings(input.industryTags)),
    market: normalizeMarket(input.market),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
}
