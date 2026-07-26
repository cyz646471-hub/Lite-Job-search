import { registrableDomainOf } from '../../engine/upstream/planner/cn-url-evidence.mjs';
import { classifyRecruitmentUrl } from '../../engine/upstream/planner/official-links.mjs';

const HARD_EXCLUDED_DOMAINS = Object.freeze([
  'jobui.com',
  '51job.com',
]);

const LEGAL_SUFFIXES = Object.freeze([
  '股份有限公司',
  '有限责任公司',
  '集团有限公司',
  '有限公司',
  '集团',
  '公司',
  'incorporated',
  'corporation',
  'company',
  'limited',
  'holdings',
  'holding',
  'inc',
  'corp',
  'ltd',
]);

function hostOf(value) {
  try {
    return new URL(String(value || '')).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function plainText(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagText(html, tag) {
  return plainText(
    String(html || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1],
  );
}

function normalizedIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function identityVariants(company = {}) {
  const raw = [
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ].map((value) => String(value || '').trim()).filter(Boolean);
  const variants = new Set();
  for (const value of raw) {
    const normalized = normalizedIdentity(value);
    if (normalized.length >= 2) variants.add(normalized);
    for (const suffix of LEGAL_SUFFIXES) {
      const normalizedSuffix = normalizedIdentity(suffix);
      if (!normalizedSuffix || !normalized.endsWith(normalizedSuffix)) continue;
      const withoutSuffix = normalized.slice(0, -normalizedSuffix.length);
      if (withoutSuffix.length >= 2) variants.add(withoutSuffix);
    }
  }
  return [...variants];
}

function fieldMatchesCompany(value, variants) {
  const normalized = normalizedIdentity(value);
  return Boolean(normalized) && variants.some((variant) => (
    normalized.includes(variant)
  ));
}

function sameDomainCorporateLinkSignal(links = [], domain, variants) {
  return (links || []).some((link) => (
    registrableDomainOf(link?.href || '') === domain
      && fieldMatchesCompany(link?.text, variants)
  ));
}

function ineligible(reasonCode) {
  return Object.freeze({
    status: 'INELIGIBLE',
    reasonCode,
    registrableDomain: null,
    matchedSignals: Object.freeze([]),
  });
}

export function bootstrapOfficialDomain({
  company = {},
  candidate = {},
  page = {},
  pageType = 'UNKNOWN',
  atsType = '',
} = {}) {
  const finalUrl = page.finalUrl || page.url || candidate.url || '';
  const host = hostOf(finalUrl);
  const domain = registrableDomainOf(finalUrl);
  if (!host || !domain) return ineligible('invalid_url');
  if (Number(page.status || 0) < 200 || Number(page.status || 0) >= 400) {
    return ineligible('unreachable');
  }
  if (pageType === 'UNKNOWN') return ineligible('unknown_page_role');
  if (atsType) return ineligible('ats_domain');
  if (
    HARD_EXCLUDED_DOMAINS.some((excluded) => hostMatches(host, excluded))
    || classifyRecruitmentUrl(finalUrl).channel === 'discovery_index'
    || /\.edu\.cn$/i.test(host)
  ) {
    return ineligible('excluded_domain');
  }

  const variants = identityVariants(company);
  if (!variants.length) {
    return Object.freeze({
      status: 'INSUFFICIENT_EVIDENCE',
      reasonCode: 'company_identity_missing',
      registrableDomain: null,
      matchedSignals: Object.freeze([]),
    });
  }

  const html = String(page.html || page.body || '');
  const fields = Object.freeze({
    title: page.title || tagText(html, 'title'),
    h1: page.h1 || tagText(html, 'h1'),
    legal: [
      page.legalEntity,
      page.copyright,
      tagText(html, 'footer'),
    ].filter(Boolean).join(' '),
  });
  const matchedSignals = Object.keys(fields)
    .filter((field) => fieldMatchesCompany(fields[field], variants));
  if (sameDomainCorporateLinkSignal(page.links, domain, variants)) {
    matchedSignals.push('corporate_link');
  }
  const uniqueSignals = [...new Set(matchedSignals)];
  if (uniqueSignals.length < 2) {
    return Object.freeze({
      status: 'INSUFFICIENT_EVIDENCE',
      reasonCode: 'independent_identity_signals_missing',
      registrableDomain: null,
      matchedSignals: Object.freeze(uniqueSignals),
    });
  }

  return Object.freeze({
    status: 'CONFIRMED',
    reasonCode: null,
    registrableDomain: domain,
    matchedSignals: Object.freeze(uniqueSignals),
  });
}
