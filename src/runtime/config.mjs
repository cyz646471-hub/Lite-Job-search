function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function loadRuntimeConfig(env = process.env) {
  const primary = String(env.SEARCH_PROVIDER_PRIMARY || 'none').toLowerCase();
  const fallback = String(env.SEARCH_PROVIDER_FALLBACK || 'none').toLowerCase();
  return {
    search: {
      primary,
      fallback,
      timeoutMs: positiveInteger(env.SEARCH_TIMEOUT_MS, 15_000),
      maxResults: Math.min(20, positiveInteger(env.SEARCH_MAX_RESULTS, 8)),
      dailyQueryBudget: positiveInteger(env.SEARCH_DAILY_QUERY_BUDGET, 300),
      cacheTtlDays: positiveInteger(env.SEARCH_CACHE_TTL_DAYS, 14),
    },
    providers: {
      tavily: { configured: Boolean(env.TAVILY_API_KEY) },
      brave: { configured: Boolean(env.BRAVE_SEARCH_API_KEY) },
      baidu: { configured: Boolean(env.BAIDU_SEARCH_API_KEY) },
      apify: { configured: Boolean(env.APIFY_TOKEN) },
    },
    browser: {
      baiduMode: String(env.CN_BAIDU_SEARCH_MODE || 'chrome').toLowerCase(),
      playwrightHeadless: String(env.PLAYWRIGHT_HEADLESS || 'true').toLowerCase() !== 'false',
    },
    llm: {
      endpoint: String(env.LITE_JOB_LLM_ENDPOINT || ''),
      model: String(env.LITE_JOB_LLM_MODEL || ''),
      configured: Boolean(env.LITE_JOB_LLM_ENDPOINT && env.LITE_JOB_LLM_MODEL),
      timeoutMs: positiveInteger(env.LITE_JOB_LLM_TIMEOUT_MS, 30_000),
      inputUsdPerMillionTokens: Number(env.LITE_JOB_LLM_INPUT_USD_PER_MILLION || 0),
      outputUsdPerMillionTokens: Number(env.LITE_JOB_LLM_OUTPUT_USD_PER_MILLION || 0),
    },
    database: {
      file: String(env.LITE_JOB_DATABASE_FILE || ''),
    },
    discovery: {
      maxQueries: Math.min(20, positiveInteger(env.LITE_JOB_DISCOVERY_MAX_QUERIES, 12)),
      maxResults: Math.min(1000, positiveInteger(env.LITE_JOB_DISCOVERY_MAX_RESULTS, 100)),
    },
  };
}

