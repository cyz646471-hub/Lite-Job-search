import { createJobResult } from './contracts.mjs';
import { canonicalCompany, normalizeText } from './normalize.mjs';

export function stableJobKey(input = {}) {
  return [
    String(input.market || '').toUpperCase(),
    canonicalCompany(input.company),
    normalizeText(input.title),
    normalizeText(input.location),
  ].join('|');
}

function firstValue(...values) {
  return values.find((value) => value !== null && value !== undefined && value !== '') ?? null;
}

function mergeResult(left, right) {
  const merged = {
    ...left,
    ...right,
    company: firstValue(right.company, left.company, ''),
    title: firstValue(right.title, left.title, ''),
    location: firstValue(right.location, left.location, ''),
    companyCareerHomeUrl: firstValue(right.companyCareerHomeUrl, left.companyCareerHomeUrl),
    campaignLandingUrl: firstValue(right.campaignLandingUrl, left.campaignLandingUrl),
    jobListUrl: firstValue(right.jobListUrl, left.jobListUrl),
    jobDetailUrl: firstValue(right.jobDetailUrl, left.jobDetailUrl),
    applyUrl: firstValue(right.applyUrl, left.applyUrl),
    evidence: [...(left.evidence || []), ...(right.evidence || [])],
    sourceUrls: [...new Set([...(left.sourceUrls || []), ...(right.sourceUrls || [])])],
    officialIdentityConfirmed: left.officialIdentityConfirmed || right.officialIdentityConfirmed,
    campaignConfirmed: left.campaignConfirmed || right.campaignConfirmed,
    hasJobList: left.hasJobList || right.hasJobList,
    hasApplicationAction: left.hasApplicationAction || right.hasApplicationAction,
  };
  return createJobResult(merged);
}

export function dedupeResults(results = []) {
  const grouped = new Map();
  for (const input of results) {
    const normalized = createJobResult(input);
    const key = stableJobKey(normalized);
    grouped.set(key, grouped.has(key) ? mergeResult(grouped.get(key), normalized) : normalized);
  }
  return [...grouped.values()];
}

