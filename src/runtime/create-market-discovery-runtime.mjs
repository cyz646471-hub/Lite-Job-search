import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createOpenAiCompatiblePlanningAdapter } from '../adapters/llm/openai-compatible-planning-adapter.mjs';
import { createSearchSourceAdapter } from '../adapters/upstream/search-source-adapter.mjs';
import { createOfficialVerificationAdapter } from '../adapters/upstream/official-verification-adapter.mjs';
import { createUpstreamJobExtractionAdapter } from '../adapters/upstream/job-extraction-adapter.mjs';
import { classifyPageAdvisory } from '../discovery/page-advisory-classifier.mjs';
import { createSearchProviders, orderedProviders } from '../search/providers.mjs';
import { SearchRouter } from '../search/router.mjs';
import { openSqliteMarketDiscoveryRepository } from '../storage/sqlite-job-repository.mjs';
import { DailyBudget } from './budget.mjs';
import { FileSearchCache, MemorySearchCache } from './cache.mjs';
import { loadRuntimeConfig } from './config.mjs';
import { createPageFetcher } from './fetch-page.mjs';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function stableId(prefix, value) {
  const digest = createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
  return `${prefix}-${digest}`;
}

function fixturePlanningModel(fixture) {
  return Object.freeze({
    configured: true,
    async generate({ task }) {
      const output = fixture?.[task];
      if (!output || typeof output !== 'object') {
        throw new Error(`missing planning fixture task: ${task}`);
      }
      return structuredClone(output);
    },
  });
}

function fixturePageFetcher(pages) {
  return async (url) => {
    const page = pages?.[url];
    if (!page) throw new Error(`missing page fixture: ${url}`);
    return structuredClone(page);
  };
}

function implicitProviderOrder(config, providers, market) {
  const explicit = orderedProviders(config, providers);
  if (explicit.length) return explicit;
  const preferred = String(market || 'NA').toUpperCase() === 'CN'
    ? ['baidu', 'tavily', 'brave']
    : ['tavily', 'brave'];
  return preferred
    .map((name) => providers[name])
    .filter((provider) => provider?.configured);
}

export async function createMarketDiscoveryRuntime({
  env = process.env,
  market = 'NA',
  databaseFile = '',
  manualEntries = [],
  planningFixture = null,
  fixturePages = null,
  fetcher = globalThis.fetch,
  resolver,
  now = () => new Date().toISOString(),
} = {}) {
  const config = loadRuntimeConfig(env);
  const providers = createSearchProviders(env, { manualEntries, fetcher });
  const providerOrder = manualEntries.length
    ? [providers.manual]
    : implicitProviderOrder(config, providers, market);
  const cacheFile = env.LITE_JOB_SEARCH_CACHE_FILE || path.join(
    env.LITE_JOB_SEARCH_CACHE_DIR || path.join(PROJECT_ROOT, 'cache'),
    'search-cache.json',
  );
  const router = new SearchRouter(providerOrder, {
    cache: manualEntries.length
      ? new MemorySearchCache()
      : new FileSearchCache({ file: cacheFile }),
    budget: new DailyBudget({ limit: config.search.dailyQueryBudget }),
    cacheTtlMs: config.search.cacheTtlDays * 86_400_000,
  });
  const planningModel = planningFixture
    ? fixturePlanningModel(planningFixture)
    : createOpenAiCompatiblePlanningAdapter({
      endpoint: config.llm.endpoint,
      model: config.llm.model,
      apiKey: env.LITE_JOB_LLM_API_KEY || '',
      timeoutMs: config.llm.timeoutMs,
      fetcher,
    });
  const fetchPage = fixturePages
    ? fixturePageFetcher(fixturePages)
    : createPageFetcher({
      fetcher,
      resolver,
      timeoutMs: config.search.timeoutMs,
    });
  const file = databaseFile
    || config.database.file
    || path.join(PROJECT_ROOT, 'data', 'lite-job-search.sqlite');
  const repository = openSqliteMarketDiscoveryRepository({ file });
  repository.migrate();
  const verificationAdapter = createOfficialVerificationAdapter({ now });
  const jobExtractor = createUpstreamJobExtractionAdapter({ fetchPage, now });
  const searchSource = createSearchSourceAdapter({ router });
  const ids = {
    intent: () => randomUUID(),
    run: () => randomUUID(),
    company: (candidate) => stableId(
      'company',
      `${String(market).toUpperCase()}|${candidate.companyIdentityKey || candidate.company}`,
    ),
    portal: (candidate) => stableId('portal', candidate.url),
    log: () => randomUUID(),
  };

  return {
    config,
    providers,
    providerOrder,
    planningModel,
    searchSource,
    verificationAdapter,
    pageAdvisoryClassifier: planningModel.configured
      ? (page) => classifyPageAdvisory(page, { planningModel, observedAt: now() })
      : null,
    jobExtractor,
    repository,
    fetchPage,
    ids,
    now,
    maxQueries: config.discovery.maxQueries,
    close: () => repository.close(),
  };
}
