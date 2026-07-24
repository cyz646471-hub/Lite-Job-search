import { createHash, randomUUID } from 'node:crypto';

import {
  adaptBrowserCompanyResult,
  createBrowserObservationFetcher,
} from '../adapters/browser/browser-page-observation-adapter.mjs';
import { createOfficialVerificationAdapter } from '../adapters/upstream/official-verification-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../adapters/upstream/job-extraction-adapter.mjs';
import { discoverMarketJobs } from './discover-market-jobs.mjs';

const BROWSER_PROVIDER = 'chrome_baidu_visible_search';

function stableId(prefix, value) {
  const digest = createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function stringList(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function createBrowserPlanningModel(query, role) {
  return Object.freeze({
    configured: true,
    async generate({ task }) {
      if (task === 'expand_keywords') {
        return {
          primaryRole: role,
          terms: [role],
          englishTerms: [],
          synonyms: [],
          exclusions: [],
          promptVersion: 'browser-company-keywords-v1',
        };
      }
      if (task === 'plan_queries') {
        return {
          queries: [{
            text: query,
            purpose: 'company_career_discovery',
            preferredSources: ['manual'],
            topK: 20,
          }],
          promptVersion: 'browser-company-query-v1',
        };
      }
      throw new Error(`unsupported browser planning task: ${task}`);
    },
  });
}

function createBrowserSearchSource(adapted) {
  return Object.freeze({
    async search(query) {
      return Object.freeze({
        status: 'ok',
        provider: BROWSER_PROVIDER,
        attempts: Object.freeze([{
          provider: BROWSER_PROVIDER,
          status: 'ok',
          networkRequest: true,
          query: query.text,
        }]),
        liveSearchExecuted: true,
        items: adapted.items,
      });
    },
  });
}

function createBrowserIds(companyResult) {
  const companyKey = companyResult.companyIdentityKey || companyResult.company;
  return Object.freeze({
    intent: () => randomUUID(),
    run: () => randomUUID(),
    company: (candidate) => stableId(
      'company',
      `CN|${candidate.companyIdentityKey || candidate.company || companyKey}`,
    ),
    portal: (candidate) => stableId('portal', candidate.url),
    log: () => randomUUID(),
  });
}

export async function ingestBrowserCompanyResult({
  companyResult,
  role = '公开招聘岗位',
  industry = [],
  location = '',
  freshnessDays = 90,
  targetCount = 1000,
} = {}, {
  repository,
  now = () => new Date().toISOString(),
  verificationAdapter = createOfficialVerificationAdapter({ now }),
  resolvePageProvider,
} = {}) {
  if (!companyResult || companyResult.status === 'FAILED' || companyResult.status === 'BLOCKED') {
    throw new Error('a completed browser company result is required');
  }
  if (!repository) throw new Error('repository is required');

  const adapted = adaptBrowserCompanyResult(companyResult);
  const fetchPage = createBrowserObservationFetcher(companyResult.observations || []);
  const jobExtractor = createUpstreamJobExtractionAdapter({
    fetchPage,
    resolvePageProvider,
    now,
  });

  return discoverMarketJobs({
    market: 'CN',
    roleType: String(role || '公开招聘岗位'),
    industryTags: stringList(industry),
    location: String(location || ''),
    freshnessDays: Math.max(1, Number(freshnessDays) || 90),
    targetCount: Math.max(1, Number(targetCount) || 1000),
  }, {
    repository,
    planningModel: createBrowserPlanningModel(adapted.query, String(role || '公开招聘岗位')),
    searchSource: createBrowserSearchSource(adapted),
    verificationAdapter,
    pageAdvisoryClassifier: null,
    jobExtractor,
    fetchPage,
    ids: createBrowserIds(companyResult),
    now,
    maxQueries: 1,
    openingRetention: 'all_observed_active',
  });
}
