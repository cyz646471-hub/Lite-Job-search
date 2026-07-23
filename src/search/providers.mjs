import {
  braveProvider,
  tavilyProvider,
} from '../../engine/upstream/planner/site-discovery.mjs';
import {
  BaiduSearchProvider,
} from '../../engine/upstream/planner/cn-search-providers.mjs';

function redact(value) {
  return String(value || '')
    .replace(/(?:authorization|bearer|api[_-]?key|token)\s*[:=]?\s*[^\s,;]+/gi, '[REDACTED]')
    .slice(0, 240);
}

function adaptProvider(name, raw, configured) {
  return {
    name,
    configured: Boolean(configured && raw),
    async search(request = {}) {
      if (!configured || !raw) return { status: 'not_configured', provider: name, items: [], networkRequests: 0 };
      try {
        const result = await raw.search(String(request.query || ''), {
          limit: request.topK || 8,
          region: request.market || 'NA',
          freshnessDays: request.freshnessDays || 30,
        });
        return { status: 'ok', provider: name, items: result.items || [], networkRequests: 1 };
      } catch (error) {
        const message = redact(error?.message || error);
        return {
          status: /429|rate/i.test(message) ? 'rate_limited' : /abort|timeout/i.test(message) ? 'timeout' : 'provider_error',
          provider: name,
          items: [],
          error: message,
          networkRequests: 1,
        };
      }
    },
  };
}

export function createSearchProviders(env = process.env, { manualEntries = [], fetcher = fetch } = {}) {
  const raw = {
    tavily: tavilyProvider({ apiKey: env.TAVILY_API_KEY, searchDepth: env.TAVILY_SEARCH_DEPTH || 'basic' }),
    brave: braveProvider({ apiKey: env.BRAVE_SEARCH_API_KEY }),
    baidu: new BaiduSearchProvider({ apiKey: env.BAIDU_SEARCH_API_KEY, endpoint: env.BAIDU_SEARCH_ENDPOINT, fetcher }),
  };
  const providers = {
    tavily: adaptProvider('tavily', raw.tavily, env.TAVILY_API_KEY),
    brave: adaptProvider('brave', raw.brave, env.BRAVE_SEARCH_API_KEY),
    baidu: {
      name: 'baidu',
      configured: Boolean(env.BAIDU_SEARCH_API_KEY),
      async search(request) {
        const result = await raw.baidu.search(request);
        return {
          ...result,
          provider: 'baidu',
          items: result.items || [],
        };
      },
    },
    manual: {
      name: 'manual',
      configured: manualEntries.length > 0,
      async search(request) {
        const query = String(request.query || '');
        return {
          status: 'ok',
          provider: 'manual',
          networkRequests: 0,
          items: manualEntries
            .filter((entry) => !entry.query || query.includes(entry.query) || query.includes(entry.company || ''))
            .slice(0, request.topK || 8)
            .map((entry, index) => ({ ...entry, rank: index + 1, discoveryMethod: 'manual' })),
        };
      },
    },
  };
  return providers;
}

export function orderedProviders(config, providers) {
  const names = [config.search.primary, config.search.fallback].filter((name, index, all) => name !== 'none' && all.indexOf(name) === index);
  return names.map((name) => providers[name]).filter(Boolean);
}

