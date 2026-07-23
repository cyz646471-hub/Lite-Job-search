import { describeSearchMode } from '../search/router.mjs';
import { openSqliteMarketDiscoveryRepository } from '../storage/sqlite-job-repository.mjs';

export function probeMarketDiscoveryDatabase(file) {
  let repository;
  const rollback = new Error('doctor rollback');
  try {
    repository = openSqliteMarketDiscoveryRepository({ file });
    repository.migrate();
    try {
      repository.withTransaction(() => {
        repository.beginRun({
          id: `doctor-${process.pid}`,
          intent: { probe: true },
          startedAt: new Date().toISOString(),
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return true;
  } catch {
    return false;
  } finally {
    repository?.close();
  }
}

export function buildDoctorReport({
  config,
  providers,
  providerOrder = [],
  databaseReady = false,
} = {}) {
  const generic = providerOrder.filter((provider) => provider?.configured);
  const mode = describeSearchMode(generic);
  const apifyConfigured = providers.apify?.configured === true || config.providers.apify.configured;
  const browserSessionRequired = config.browser.baiduMode === 'chrome';
  return {
    providerCodeImplemented: [
      'baidu',
      'baidu_chrome',
      'tavily',
      'brave',
      'apify_google',
      'manual',
      'deterministic_official_discovery',
    ],
    searchMode: mode.mode,
    primaryProvider: mode.primary,
    fallbackProvider: mode.fallback,
    providers: Object.fromEntries(
      Object.entries(config.providers).map(([name, value]) => [name, value.configured ? 'configured' : 'not_configured']),
    ),
    browserBaidu: browserSessionRequired ? 'browser_session_required' : 'disabled',
    networkConnectivity: 'not_tested',
    connectivityVerified: false,
    timeoutMs: config.search.timeoutMs,
    dailyQueryBudget: config.search.dailyQueryBudget,
    cache: {
      status: 'configured',
      ttlDays: config.search.cacheTtlDays,
    },
    canRunLiveSearch: generic.length > 0,
    canRunApifyBatch: apifyConfigured,
    liveSearchExecuted: false,
    benchmarkCompleted: false,
    llmPlanning: config.llm?.configured ? 'configured' : 'not_configured',
    database: databaseReady ? 'ready' : 'not_ready',
    marketDiscoveryReady: Boolean(
      config.llm?.configured
      && generic.length > 0
      && databaseReady
    ),
  };
}
