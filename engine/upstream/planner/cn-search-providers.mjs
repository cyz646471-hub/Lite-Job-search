import { createHash } from 'node:crypto';
import { createSearchProviders } from './cn-official-search.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const redact = (value) => String(value || '').replace(/(?:authorization|x-appbuilder-authorization|bearer|api[_-]?key|token)\s*[:=]?\s*[^\s,;]+/gi, '[REDACTED]');
const recency = (value) => ({ week: 'week', month: 'month', semiyear: 'semiyear', year: 'year', '7d': 'week', '30d': 'month', '180d': 'semiyear', '365d': 'year' })[String(value || '').toLowerCase()] || null;

async function responseJson(response) {
  const raw = await response.text();
  try { return { raw, json: JSON.parse(raw) }; } catch { return { raw, json: {} }; }
}

export class BaiduSearchProvider {
  constructor({ apiKey = process.env.BAIDU_SEARCH_API_KEY, endpoint = process.env.BAIDU_SEARCH_ENDPOINT || 'https://qianfan.baidubce.com/v2/ai_search/web_search', fetcher = fetch, maxRetries = 2, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), random = Math.random } = {}) {
    this.name = 'baidu'; this.apiKey = apiKey; this.endpoint = endpoint; this.fetcher = fetcher; this.maxRetries = maxRetries; this.sleep = sleep; this.random = random;
  }
  isConfigured() { return Boolean(this.apiKey); }
  async search(request = {}) {
    const started = Date.now();
    if (!this.isConfigured()) return { provider: this.name, status: 'not_configured', items: [], retrievedAt: started, durationMs: 0 };
    const body = {
      messages: [{ role: 'user', content: String(request.query || '') }], search_source: 'baidu_search_v2',
      resource_type_filter: [{ type: 'web', top_k: Math.min(20, Math.max(1, Number(request.topK || 8))) }],
    };
    if ((request.includeSites || []).length) body.search_filter = { match: { site: request.includeSites.slice(0, 20) } };
    const timeFilter = recency(request.recency);
    if (timeFilter) body.search_recency_filter = timeFilter;
    const retries = Math.max(0, Number(request.maxRetries ?? this.maxRetries));
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (request.beforeRequest && !request.beforeRequest(this.name)) return { provider: this.name, status: 'budget_exhausted', items: [], retrievedAt: started, durationMs: Date.now() - started, attemptsMade: attempt, networkRequests: attempt };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, Number(request.timeoutMs || process.env.SEARCH_TIMEOUT_MS || 15_000)));
      try {
        const response = await this.fetcher(this.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        const parsed = await responseJson(response);
        const base = { provider: this.name, items: [], retrievedAt: started, durationMs: Date.now() - started, rawResponseHash: hash(parsed.raw), attemptsMade: attempt + 1, networkRequests: attempt + 1 };
        if (response.status === 403) return { ...base, status: 'forbidden', errorCode: 'http_403' };
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < retries) { await this.sleep(250 * (2 ** attempt) + Math.floor(this.random() * 101)); continue; }
        if (response.status === 429) return { ...base, status: 'rate_limited', errorCode: 'http_429' };
        if (!response.ok) return { ...base, status: response.status >= 500 ? 'provider_error' : 'request_error', errorCode: `http_${response.status}` };
        const items = (parsed.json.references || []).filter((item) => item?.url).slice(0, request.topK || 8).map((item, index) => ({ title: item.title || item.web_anchor || '', snippet: item.content || '', url: item.url, rank: index + 1, publishedAt: item.date || null }));
        return { ...base, status: items.length ? 'success' : 'no_results', items };
      } catch (error) {
        if (attempt < retries) { await this.sleep(250 * (2 ** attempt) + Math.floor(this.random() * 101)); continue; }
        return { provider: this.name, status: error?.name === 'AbortError' ? 'timeout' : 'provider_error', items: [], retrievedAt: started, durationMs: Date.now() - started, attemptsMade: attempt + 1, networkRequests: attempt + 1, errorCode: redact(error?.message || error).slice(0, 160) };
      } finally { clearTimeout(timeout); }
    }
    return { provider: this.name, status: 'provider_error', items: [], retrievedAt: started, durationMs: Date.now() - started, errorCode: 'retry_loop_exhausted' };
  }
}

function visibleNaturalItems(rows, topK = 8) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && String(row.url || '').startsWith('http'))
    .filter((row) => !['ad', 'news', 'advertisement', 'sponsored'].includes(String(row.kind || '').toLowerCase()))
    .slice(0, Math.max(1, Number(topK) || 8))
    .map((row, index) => ({
      title: String(row.title || '').trim(),
      url: String(row.url || '').trim(),
      snippet: String(row.snippet || '').trim(),
      rank: index + 1,
      publishedAt: row.publishedAt || null,
    }));
}

export class ChromeBaiduSearchProvider {
  constructor({ readVisibleResults = null } = {}) {
    this.name = 'baidu_chrome';
    this.readVisibleResults = readVisibleResults;
  }
  isConfigured() { return typeof this.readVisibleResults === 'function'; }
  async search(request = {}) {
    const started = Date.now();
    if (!this.isConfigured()) return { provider: this.name, status: 'browser_unavailable', items: [], retrievedAt: started, durationMs: 0, networkRequests: 0 };
    try {
      const rows = await this.readVisibleResults({ query: String(request.query || ''), topK: Math.min(8, Math.max(1, Number(request.topK || 8))) });
      const items = visibleNaturalItems(rows, request.topK);
      return {
        provider: this.name,
        status: items.length ? 'success' : 'no_results',
        items,
        retrievedAt: started,
        durationMs: Date.now() - started,
        rawResponseHash: hash(JSON.stringify(rows || [])),
        attemptsMade: 1,
        networkRequests: 1,
      };
    } catch (error) {
      return {
        provider: this.name,
        status: 'browser_unavailable',
        items: [],
        retrievedAt: started,
        durationMs: Date.now() - started,
        errorCode: redact(error?.message || error).slice(0, 160),
        attemptsMade: 1,
        networkRequests: 0,
      };
    }
  }
}

export class ExistingSearchProviderBridge {
  constructor(name, provider) { this.name = name; this.provider = provider; }
  isConfigured() { return Boolean(this.provider?.isConfigured?.() ?? this.provider); }
  async search(request = {}) {
    if (!this.isConfigured()) return { provider: this.name, status: 'not_configured', items: [], retrievedAt: Date.now(), durationMs: 0 };
    if (request.beforeRequest && !request.beforeRequest(this.name)) return { provider: this.name, status: 'budget_exhausted', items: [], retrievedAt: Date.now(), durationMs: 0, networkRequests: 0 };
    const result = await this.provider.search({ text: request.query }, { maxResults: request.topK || 8, timeoutMs: request.timeoutMs, freshnessDays: request.recency ? 30 : 365 });
    return { provider: this.name, status: result.status, items: (result.candidates || []).map((item, index) => ({ title: item.title || '', snippet: item.snippet || '', url: item.url, rank: item.rank || index + 1, publishedAt: item.publishedAt || null })), rawResponseHash: hash(JSON.stringify(result.candidates || [])), retrievedAt: Date.parse(result.requestedAt) || Date.now(), durationMs: result.durationMs || 0, errorCode: result.errorCode, attemptsMade: 1, networkRequests: 1 };
  }
}

const FALLBACK_STATUSES = new Set(['not_configured', 'browser_unavailable', 'forbidden', 'rate_limited', 'timeout', 'provider_error', 'request_error']);
export class SearchProviderRouter {
  constructor({ providers = [], budgetTracker = null } = {}) { this.providers = providers; this.budgetTracker = budgetTracker; }
  async search(request = {}) {
    const attempts = [];
    for (const provider of this.providers) {
      if (!provider?.isConfigured?.()) { attempts.push({ provider: provider?.name || 'unknown', status: 'not_configured' }); continue; }
      const result = await provider.search({ ...request, beforeRequest: provider.name === 'manual' ? null : () => this.budgetTracker ? this.budgetTracker.tryConsume(provider.name) : true });
      attempts.push({ provider: provider.name, status: result.status, durationMs: result.durationMs || 0, errorCode: result.errorCode || null, networkRequests: result.networkRequests || 0 });
      if (result.status === 'budget_exhausted') return { ...result, attempts, fallbackCount: Math.max(0, attempts.length - 1) };
      if (!FALLBACK_STATUSES.has(result.status)) return { ...result, durationMs: attempts.reduce((sum, item) => sum + (item.durationMs || 0), 0), networkRequests: attempts.reduce((sum, item) => sum + (item.networkRequests || 0), 0), attempts, fallbackCount: Math.max(0, attempts.length - 1) };
    }
    const last = attempts.at(-1) || { provider: 'none', status: 'not_configured' };
    return { provider: last.provider, status: last.status, items: [], retrievedAt: Date.now(), durationMs: attempts.reduce((sum, item) => sum + (item.durationMs || 0), 0), networkRequests: attempts.reduce((sum, item) => sum + (item.networkRequests || 0), 0), attempts, fallbackCount: Math.max(0, attempts.length - 1) };
  }
}

export function createDailySearchBudget({ limit = Infinity, used = 0, limitByProvider = {}, usedByProvider = {} } = {}) {
  let consumed = Math.max(0, Number(used) || 0), cap = Number.isFinite(Number(limit)) ? Math.max(0, Number(limit)) : Infinity;
  const providerUsed = Object.fromEntries(Object.entries(usedByProvider || {}).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]));
  const providerLimits = Object.fromEntries(Object.entries(limitByProvider || {}).filter(([, value]) => Number.isFinite(Number(value))).map(([key, value]) => [key, Math.max(0, Number(value))]));
  return {
    tryConsume(provider = 'unknown') {
      const providerLimit = providerLimits[provider] ?? Infinity, current = providerUsed[provider] || 0;
      if (consumed >= cap || current >= providerLimit) return false;
      consumed++; providerUsed[provider] = current + 1; return true;
    },
    snapshot() {
      return {
        limit: cap, used: consumed, remaining: Number.isFinite(cap) ? Math.max(0, cap - consumed) : null,
        limitByProvider: providerLimits, usedByProvider: { ...providerUsed },
        remainingByProvider: Object.fromEntries(Object.entries(providerLimits).map(([provider, providerLimit]) => [provider, Math.max(0, providerLimit - (providerUsed[provider] || 0))])),
      };
    },
  };
}

export function sanitizeProviderDiagnostic(value) { return redact(value); }

export function interpretSearchProbe(result = {}) {
  const status = result.status || 'unknown';
  const liveSearchExecuted = Number(result.networkRequests || 0) > 0;
  const reachable = liveSearchExecuted
    && !['timeout', 'provider_error', 'request_error', 'not_configured', 'budget_exhausted'].includes(status);
  return { status, reachable, liveSearchExecuted };
}

class OptionalUnifiedProvider {
  constructor(name, provider = null) { this.name = name; this.provider = provider; }
  isConfigured() { return Boolean(this.provider?.isConfigured?.() ?? this.provider); }
  async search(request) {
    if (!this.isConfigured()) return { provider: this.name, status: 'not_configured', items: [], retrievedAt: Date.now(), durationMs: 0 };
    if (request.beforeRequest && !request.beforeRequest(this.name)) return { provider: this.name, status: 'budget_exhausted', items: [], retrievedAt: Date.now(), durationMs: 0, networkRequests: 0 };
    if (typeof this.provider.search === 'function') { const result = await this.provider.search(request); return { ...result, networkRequests: result.networkRequests ?? 1, attemptsMade: result.attemptsMade ?? 1 }; }
    return { provider: this.name, status: 'provider_error', items: [], retrievedAt: Date.now(), durationMs: 0, errorCode: 'unsupported_provider_adapter' };
  }
}

class ManualUnifiedProvider {
  constructor(entries = []) { this.name = 'manual'; this.entries = entries; }
  isConfigured() { return this.entries.length > 0; }
  async search(request = {}) {
    const query = String(request.query || ''), items = this.entries.filter((entry) => !entry.query || query.includes(entry.query) || query.includes(entry.company || '')).slice(0, request.topK || 10).map((entry, index) => ({ title: entry.title || `${entry.company || ''}人工确认入口`, snippet: entry.notes || '', url: entry.url, rank: index + 1, publishedAt: null, discoveryMethod: 'manual' }));
    return { provider: this.name, status: items.length ? 'success' : this.isConfigured() ? 'no_results' : 'not_configured', items, retrievedAt: Date.now(), durationMs: 0, rawResponseHash: hash(JSON.stringify(items)) };
  }
}

export function createCnSearchProviderRouter(env = process.env, { market = 'CN', fetcher = fetch, apifyProvider = null, manualEntries = [], budgetTracker = null, chromeBaiduProvider = null } = {}) {
  const legacy = createSearchProviders(env);
  const baidu = new BaiduSearchProvider({ apiKey: env.BAIDU_SEARCH_API_KEY, endpoint: env.BAIDU_SEARCH_ENDPOINT, fetcher });
  const chromeBaidu = chromeBaiduProvider || new ChromeBaiduSearchProvider();
  const brave = new ExistingSearchProviderBridge('brave', legacy.all.brave);
  const tavily = new ExistingSearchProviderBridge('tavily', legacy.all.tavily);
  const apify = new OptionalUnifiedProvider('apify_google', apifyProvider);
  const manual = new ManualUnifiedProvider(manualEntries);
  const baiduMode = String(env.CN_BAIDU_SEARCH_MODE || 'chrome').toLowerCase();
  const domesticProviders = baiduMode === 'api'
    ? [baidu, brave, apify, tavily, manual]
    : baiduMode === 'chrome_api_fallback'
      ? [chromeBaidu, baidu, brave, apify, tavily, manual]
      : [chromeBaidu, brave, apify, tavily, manual];
  const providers = String(market).toUpperCase() === 'MULTINATIONAL'
    ? [brave, ...(baiduMode === 'api' ? [baidu] : []), apify, tavily, manual]
    : domesticProviders;
  return new SearchProviderRouter({ providers, budgetTracker });
}

export function summarizeCnSearchConfiguration(env = process.env, { market = 'CN' } = {}) {
  const baiduMode = String(env.CN_BAIDU_SEARCH_MODE || 'chrome').toLowerCase();
  const chromeSessionRequired = String(market).toUpperCase() !== 'MULTINATIONAL' && baiduMode !== 'api';
  const configured = {
    baiduChrome: baiduMode !== 'api' ? 'browser_session_required' : 'disabled_by_mode',
    baidu: Boolean(env.BAIDU_SEARCH_API_KEY),
    brave: Boolean(env.BRAVE_SEARCH_API_KEY),
    tavily: Boolean(env.TAVILY_API_KEY),
    apify: Boolean(env.APIFY_TOKEN),
  };
  const directOrder = String(market).toUpperCase() === 'MULTINATIONAL'
    ? ['brave', ...(baiduMode === 'api' ? ['baidu'] : []), 'tavily']
    : baiduMode === 'api'
      ? ['baidu', 'brave', 'tavily']
      : ['brave', 'tavily'];
  const directProviders = directOrder.filter((name) => configured[name]);
  const searchMode = chromeSessionRequired
    ? 'chrome_session_required'
    : directProviders.length === 0
      ? 'no_provider'
      : directProviders.length === 1
        ? 'single_provider'
        : 'primary_fallback';
  const primaryProvider = chromeSessionRequired ? 'baidu_chrome' : directProviders[0] || 'none';
  const fallbackProvider = chromeSessionRequired ? directProviders[0] || 'none' : directProviders[1] || 'none';
  return {
    searchMode,
    primaryProvider,
    fallbackProvider,
    configured,
    route: String(market).toUpperCase() === 'MULTINATIONAL'
      ? [...directOrder.slice(0, 2), 'apify_google', ...directOrder.slice(2), 'manual']
      : baiduMode === 'api'
        ? ['baidu', 'brave', 'apify_google', 'tavily', 'manual']
        : baiduMode === 'chrome_api_fallback'
          ? ['baidu_chrome', 'baidu', 'brave', 'apify_google', 'tavily', 'manual']
          : ['baidu_chrome', 'brave', 'apify_google', 'tavily', 'manual'],
    baiduMode,
    primaryKey: chromeSessionRequired ? 'browser_session_required' : primaryProvider === 'none' ? 'not_configured' : 'configured',
    fallbackKey: fallbackProvider === 'none' ? 'not_configured' : 'configured',
    canExecuteLiveSearch: directProviders.length > 0,
    apifyBatchSearchAvailable: configured.apify,
    timeoutMs: Number(env.SEARCH_TIMEOUT_MS || 15_000),
    maxResults: Number(env.SEARCH_MAX_RESULTS || 8),
    dailyBudget: Number(env.CN_OFFICIAL_SEARCH_DAILY_QUERY_BUDGET || env.SEARCH_DAILY_QUERY_BUDGET || 300),
  };
}
