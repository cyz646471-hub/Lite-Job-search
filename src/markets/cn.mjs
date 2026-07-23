import {
  officialQueries,
  scoreOfficialCandidate,
} from '../../engine/upstream/planner/cn-official-search.mjs';
import { registrableDomainOf } from '../../engine/upstream/planner/cn-url-evidence.mjs';

export function cnQueries({ company, officialDomain, cohortYear, recruitmentType, maxQueries = 3 }) {
  return officialQueries({
    company,
    officialDomain,
    cohortYear,
    recruitmentType,
  }, { limit: maxQueries });
}

export function scoreCnSearchItem(item, context) {
  const scored = scoreOfficialCandidate(item, {
    company: context.company,
    officialDomain: context.officialDomain,
    cohortYear: context.cohortYear,
    recruitmentType: context.recruitmentType,
  });
  return {
    market: 'CN',
    company: context.company,
    title: item.title || '',
    url: item.url,
    snippet: item.snippet || '',
    rank: item.rank,
    source: context.provider || null,
    officialDomain: context.officialDomain || registrableDomainOf(item.url),
    score: scored.totalScore,
    decision: scored.decision,
    classification: scored.classification,
    strongIdentity: scored.strongIdentity,
    evidence: [...scored.positiveEvidence, ...scored.negativeEvidence],
    rejectionReasons: scored.hardRejectReasons,
  };
}

export function isHighConfidenceCn(candidate) {
  return candidate.decision === 'auto_verify';
}

