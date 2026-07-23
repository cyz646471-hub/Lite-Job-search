const FALLBACK_STATUSES = new Set([
  'browser_unavailable',
  'forbidden',
  'not_configured',
  'provider_error',
  'rate_limited',
  'request_error',
  'timeout',
]);

export function describeSearchMode(providers = []) {
  const configured = providers.filter((provider) => provider?.configured !== false);
  if (!configured.length) return { mode: 'no_provider', primary: 'none', fallback: 'none' };
  if (configured.length === 1) {
    return { mode: 'single_provider', primary: configured[0].name, fallback: 'none' };
  }
  return {
    mode: 'primary_fallback',
    primary: configured[0].name,
    fallback: configured[1].name,
  };
}

export class SearchRouter {
  constructor(providers = [], { budget = null, cache = null, cacheTtlMs = 14 * 86_400_000 } = {}) {
    this.providers = providers.filter((provider) => provider?.configured !== false);
    this.budget = budget;
    this.cache = cache;
    this.cacheTtlMs = cacheTtlMs;
  }

  mode() {
    return describeSearchMode(this.providers);
  }

  async search(request = {}) {
    const query = String(request.query || '').trim();
    const routeNamespace = this.providers.map((provider) => provider.name).join('>') || 'none';
    const requestKey = request.cacheKey || `${request.market || ''}|${query}|${request.topK || 8}`;
    const cacheKey = `${routeNamespace}|${requestKey}`;
    const cached = this.cache?.get(cacheKey);
    if (cached) return { ...cached, cacheHit: true, liveSearchExecuted: false };
    if (!this.providers.length) {
      return {
        status: 'not_configured',
        provider: 'none',
        items: [],
        attempts: [],
        liveSearchExecuted: false,
      };
    }
    const attempts = [];
    for (const provider of this.providers) {
      if (this.budget && !this.budget.tryConsume(provider.name)) {
        attempts.push({ provider: provider.name, status: 'search_deferred_by_budget' });
        return {
          status: 'search_deferred_by_budget',
          provider: provider.name,
          items: [],
          attempts,
          liveSearchExecuted: attempts.some((item) => item.networkRequest),
        };
      }
      let result;
      try {
        result = await provider.search(request);
      } catch (error) {
        result = { status: 'provider_error', items: [], error: String(error?.message || error) };
      }
      const normalized = {
        status: result.status || 'ok',
        provider: result.provider || provider.name,
        items: Array.isArray(result.items) ? result.items : [],
      };
      attempts.push({
        provider: provider.name,
        status: normalized.status,
        networkRequest: result.networkRequests !== 0,
      });
      if (normalized.status === 'ok' || normalized.status === 'success') {
        const output = {
          ...normalized,
          attempts,
          liveSearchExecuted: attempts.some((item) => item.networkRequest),
        };
        this.cache?.set(cacheKey, output, { ttlMs: this.cacheTtlMs });
        return output;
      }
      if (!FALLBACK_STATUSES.has(normalized.status)) {
        return { ...normalized, attempts, liveSearchExecuted: true };
      }
    }
    const last = attempts.at(-1);
    return {
      status: last?.status || 'not_configured',
      provider: last?.provider || 'none',
      items: [],
      attempts,
      liveSearchExecuted: attempts.some((item) => item.networkRequest),
    };
  }
}
