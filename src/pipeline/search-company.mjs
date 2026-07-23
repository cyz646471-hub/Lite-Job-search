import { normalizeMarket } from '../core/contracts.mjs';
import { cnQueries, isHighConfidenceCn, scoreCnSearchItem } from '../markets/cn.mjs';
import { isHighConfidenceNa, naQueries, scoreNaSearchItem } from '../markets/na.mjs';

function dedupeCandidates(candidates) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate.url) continue;
    const existing = byUrl.get(candidate.url);
    if (!existing || candidate.score > existing.score) byUrl.set(candidate.url, candidate);
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score || (a.rank || 999) - (b.rank || 999));
}

export async function searchCompany({
  market,
  company,
  officialDomain = null,
  cohortYear = null,
  recruitmentType = null,
  router,
  maxQueries = 3,
  topK = 8,
  freshnessDays = 30,
} = {}) {
  const normalizedMarket = normalizeMarket(market);
  if (!company?.trim()) throw new Error('company is required');
  if (!router?.search) throw new Error('search router is required');
  const context = { company: company.trim(), officialDomain, cohortYear, recruitmentType };
  const queries = normalizedMarket === 'CN'
    ? cnQueries({ ...context, maxQueries })
    : naQueries({ ...context, maxQueries });
  const score = normalizedMarket === 'CN' ? scoreCnSearchItem : scoreNaSearchItem;
  const highConfidence = normalizedMarket === 'CN' ? isHighConfidenceCn : isHighConfidenceNa;
  const candidates = [];
  const queriesExecuted = [];
  const providerAttempts = [];
  let terminalStatus = 'no_results';

  for (const query of queries) {
    const response = await router.search({
      query,
      market: normalizedMarket,
      topK,
      freshnessDays,
      cacheKey: `${normalizedMarket}|${company}|${query}`,
    });
    queriesExecuted.push(query);
    providerAttempts.push(...(response.attempts || []));
    if (response.status === 'search_deferred_by_budget') {
      terminalStatus = 'search_deferred_by_budget';
      break;
    }
    if (!['ok', 'success'].includes(response.status)) {
      terminalStatus = response.status;
      continue;
    }
    const scored = response.items.map((item, index) => score({
      ...item,
      rank: item.rank || index + 1,
    }, { ...context, provider: response.provider }));
    candidates.push(...scored.filter((candidate) => candidate.decision !== 'reject'));
    terminalStatus = candidates.length ? 'candidates_found' : 'no_results';
    if (scored.some(highConfidence)) break;
  }

  return {
    market: normalizedMarket,
    company: context.company,
    status: terminalStatus,
    queriesExecuted,
    providerAttempts,
    candidates: dedupeCandidates(candidates),
  };
}

