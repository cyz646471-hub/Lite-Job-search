import { resolveCompanyName } from '../../engine/upstream/planner/cn-company-resolver.mjs';
import { createDiscoveryLog } from '../domain/discovery-log.mjs';

const TRUSTED_DOMAIN_SOURCES = new Set([
  'registry',
  'official_backlink',
  'manual_verified',
]);

function companyHintOf(item = {}) {
  const explicit = String(item.company || item.companyName || item.organization || '').trim();
  if (explicit) return explicit;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  return title.match(
    /^(.{2,80}?)(?:招聘官网|招聘职位|校园招聘|社会招聘|招聘|Careers|Jobs)(?:\s|[-–—:：|｜]|$)/i,
  )?.[1]?.trim() || '';
}

function canonicalUrlOf(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

function confirmedOfficialDomainOf(item) {
  if (!TRUSTED_DOMAIN_SOURCES.has(item.officialDomainSource)) return null;
  return String(item.confirmedOfficialDomain || item.officialDomain || '').trim().toLowerCase() || null;
}

export async function discoverCompanies({
  intent,
  queryPlan,
  searchSource,
  runId,
  now = new Date().toISOString(),
} = {}) {
  if (!intent?.id || !runId) throw new Error('intent and runId are required');
  if (!searchSource || typeof searchSource.search !== 'function') {
    throw new Error('searchSource.search is required');
  }
  const candidatesByUrl = new Map();
  const logs = [];
  const providerAttempts = [];
  let status = 'COMPLETE';
  let liveSearchExecuted = false;

  const appendLog = (input) => {
    logs.push(createDiscoveryLog({
      id: `${runId}:${logs.length + 1}`,
      runId,
      searchIntentId: intent.id,
      searchedAt: now,
      ...input,
    }));
  };

  for (const query of queryPlan?.queries || []) {
    const response = await searchSource.search(query, intent);
    providerAttempts.push(...(response.attempts || []));
    liveSearchExecuted ||= response.liveSearchExecuted === true;
    if (response.status === 'search_deferred_by_budget') {
      status = 'DEFERRED_BY_BUDGET';
      break;
    }
    if (response.status === 'not_configured') {
      status = 'NOT_CONFIGURED';
      break;
    }
    if (!['ok', 'success'].includes(response.status)) {
      status = 'PARTIAL';
      continue;
    }

    for (const [index, item] of (response.items || []).entries()) {
      const canonicalUrl = canonicalUrlOf(item.url);
      const rank = Number(item.rank) || index + 1;
      if (!canonicalUrl) {
        appendLog({
          query: query.text,
          expandedKeywords: [],
          searchSource: response.provider,
          resultUrl: null,
          resultRank: rank,
          outcome: 'REJECTED',
          metadata: { reason: 'invalid_url' },
        });
        continue;
      }
      const resolvedCompany = resolveCompanyName(companyHintOf(item));
      if (!resolvedCompany.canonicalName) {
        appendLog({
          query: query.text,
          expandedKeywords: [],
          searchSource: response.provider,
          resultUrl: canonicalUrl,
          resultRank: rank,
          outcome: 'REVIEW_REQUIRED',
          metadata: { reason: 'company_identity_missing' },
        });
        continue;
      }
      const candidate = {
        ...item,
        company: resolvedCompany.canonicalName,
        companyIdentityKey: resolvedCompany.companyId,
        aliases: item.aliases || [],
        url: canonicalUrl,
        rank,
        searchSource: response.provider,
        sourceType: item.sourceType || 'unknown',
        query: query.text,
        confirmedOfficialDomain: confirmedOfficialDomainOf(item),
      };
      const prior = candidatesByUrl.get(canonicalUrl);
      if (!prior || candidate.rank < prior.rank) candidatesByUrl.set(canonicalUrl, candidate);
      appendLog({
        query: query.text,
        expandedKeywords: [],
        searchSource: response.provider,
        resultUrl: canonicalUrl,
        resultRank: rank,
        outcome: prior ? 'DUPLICATE' : 'DISCOVERED',
        metadata: { sourceType: candidate.sourceType },
      });
    }
  }

  return Object.freeze({
    status,
    candidates: Object.freeze(
      [...candidatesByUrl.values()].sort((left, right) => left.rank - right.rank),
    ),
    logs: Object.freeze(logs),
    providerAttempts: Object.freeze(providerAttempts),
    liveSearchExecuted,
  });
}
