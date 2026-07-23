import {
  isCandidateOwned,
  queriesForCompany,
  scoreCandidate,
} from '../../engine/upstream/planner/site-discovery.mjs';
import { registrableDomainOf } from '../../engine/upstream/planner/cn-url-evidence.mjs';

export function naQueries({ company, maxQueries = 4 }) {
  return queriesForCompany(company, { region: 'NA', limit: maxQueries });
}

export function scoreNaSearchItem(item, context) {
  const score = scoreCandidate({
    ...item,
    companyName: context.company,
  });
  const owned = isCandidateOwned(item.url, context.company);
  return {
    market: 'NA',
    company: context.company,
    title: item.title || '',
    url: item.url,
    snippet: item.snippet || '',
    rank: item.rank,
    source: context.provider || null,
    officialDomain: owned ? registrableDomainOf(item.url) : null,
    score,
    owned,
    decision: owned && score >= 0.75 ? 'auto_verify' : score > 0 ? 'review' : 'reject',
    evidence: owned ? ['company_brand_matches_domain'] : [],
    rejectionReasons: score > 0 ? [] : ['irrelevant_or_blocked_domain'],
  };
}

export function isHighConfidenceNa(candidate) {
  return candidate.owned === true && candidate.score >= 0.75;
}

