import { describeSearchMode } from '../search/router.mjs';

export function buildDoctorReport({ config, providers, providerOrder = [] } = {}) {
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
  };
}
