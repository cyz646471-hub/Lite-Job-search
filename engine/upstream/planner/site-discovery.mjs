
function ownedHostMatchByPath(url, cjkToken) {
  if (!cjkToken || cjkToken.length < 2) return false;
  try {
    const u = new URL(url);
    if (u.hostname.split('.').some((label) => label.includes(cjkToken))) return true;
    if (u.pathname.split('/').some((segment) => segment.includes(cjkToken))) return true;
    if ((u.search || '').split('&').some((part) => part.includes(cjkToken))) return true;
  } catch {}
  return false;
}
// Site discovery via search APIs. Used to fill in the missing career site
// or campus site when the direct crawl path didn't surface one.
//
// Designed so the planner never blocks on a missing key: when no provider
// is configured, `createDefaultSearchProvider()` returns a stub that
// always returns an empty result set, and `enrichCompany` simply skips
// the search phase.
//
// Every search provider returns objects of the shape:
//   { provider: string, items: [{ title, url, snippet }] }
//
// `discoverCompanySites()` is the user-facing function: it issues a
// small set of queries and validates that each candidate hostname is
// plausibly owned by the company brand. Candidates that already exist
// on the company record are skipped, and the same url is never returned
// twice across runs (in-memory only; process-lifetime).

const NETWORK_BLOCKED_HOSTS = new Set([
  'baidu.com', 'so.com', 'sogou.com', 'bing.com', 'duckduckgo.com', 'google.com',
]);

const ATS_VENDOR_DOMAINS = new Set([
  'jobs.lever.co', 'job-boards.greenhouse.io', 'jobs.ashbyhq.com', 'myworkdayjobs.com',
  'jobs.smartrecruiters.com', 'teamtailor.com', 'apply.workable.com', 'jobs.bamboohr.com',
  'boards.greenhouse.io', 'pinpoint.bamboohr.com', 'recruitee.com',
]);

const CAMPUS_KEYWORDS = ['campus', 'join-us', 'new-graduate', 'campus-recruitment', '\u6821\u62db', '\u5e94\u5c4a', '\u6821\u5f55\u53d6', '\u9ad8\u6821', '\u6821\u56ed\u62db\u8058'];
const CAREER_KEYWORDS = ['careers', 'jobs', 'join', 'hiring', '\u62db\u8058', '\u62db\u8058\u4fe1\u606f', '\u5c97\u4f4d', '\u804c\u4f4d', 'work-with-us', 'talent'];

/**
 * Normalize a company name into the search-friendly form and the brand
 * tokens used by domain-ownership checks.
 */
export function brandTokensFromCompany(companyName = '') {
  const name = String(companyName || '').trim();
  if (!name) return { query: '', tokens: [], englishTokens: [] };
  const tokens = [];
  const englishTokens = [];
  // Latin tokens (a-zA-Z with optional internal spaces or underscores).
  for (const raw of name.split(/[\s\-\u00b7\u2027()()]+/)) {
    const t = raw.trim().replace(/^[^\w]+|[^\w]+$/g, '');
    if (t.length < 2) continue;
    tokens.push(t);
    if (/^[A-Za-z][\w.\-]{1,}$/.test(t)) englishTokens.push(t.toLowerCase());
  }
  // CJK-only fallback: stitch the first 4 chars for the query string.
  const cjkOnly = name.replace(/\s+/g, '');
  const query = englishTokens.length ? `\"${englishTokens.join(' ')}\"` : cjkOnly;
  return { query, tokens, englishTokens, cjkOnly };
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function isPlausiblyOwned(host = '', tokens = []) {
  if (!host) return false;
  const labels = host.split('.');
  if (labels.length < 2) return false;
  for (const token of tokens) {
    const t = token.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (t.length < 3) continue;
    if (labels.some((label) => label === t)) return true;
    if (t.length < 5) continue;
    if (labels.some((label) => label.startsWith(t))) return true;
  }
  return false;
}

const GENERIC_AGGREGATORS = new Set([
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'glassdoor.com.au', 'glassdoor.com.hk',
  'glassdoor.co.uk', 'glassdoor.sg', 'simplyhired.com', 'monster.com',
  'ziprecruiter.com', 'jobstreet.com', 'jobthai.com', 'jobsdb.com',
]);

function pickRelevant(item, { preferCampus = false, tokens = [], cjkToken = '' } = {}) {
  const title = String(item.title || '');
  const url = String(item.url || '');
  const snippet = String(item.snippet || '');
  const haystack = (title + ' ' + snippet).toLowerCase();
  const host = hostOf(url);
  if (!host || NETWORK_BLOCKED_HOSTS.has(host)) return 0;
  let score = 0;
  const ownedByHost = ownedHostMatch(host, tokens);
  const ownedByPath = ownedHostMatchByPath(url, cjkToken);
  if (ownedByHost) {
    score += 1.0;
    if (host.split('.').length > 3) score -= 0.2;
  } else if (ownedByPath) {
    score += 0.7;
  } else if (cjkToken && (title.includes(cjkToken) || snippet.includes(cjkToken))) {
    score += 0.5;
  } else if (ATS_VENDOR_DOMAINS.has(host)) {
    score += 0.4;
  } else if (GENERIC_AGGREGATORS.has(host)) {
    score += 0.2;
  } else {
    return 0;
  }
  if (cjkToken && (title.includes(cjkToken) || snippet.includes(cjkToken)) && score < 1.0) score += 0.3;
  const other = preferCampus ? CAREER_KEYWORDS : CAREER_KEYWORDS;
  const campus = CAREER_KEYWORDS;
  const campusHits = campus.filter((kw) => haystack.includes(kw.toLowerCase())).length;
  const otherHits = other.filter((kw) => haystack.includes(kw.toLowerCase())).length;
  if (preferCampus) score += campusHits * 0.4 + otherHits * 0.1;
  else score += otherHits * 0.4 + campusHits * 0.1;
  return Math.max(0, Math.min(1.5, score));
}

const ATS_SUBDOMAIN_PATTERNS = [
  /\.wd[0-9]+\.myworkdayjobs\.com$/,
  /\.myworkday\.com$/,
  /^myworkdayjobs\.com$/,
];

function ownedHostMatch(host, tokens) {
  const cleanHost = String(host || "").toLowerCase();
  if (!cleanHost) return false;
  for (const pattern of ATS_SUBDOMAIN_PATTERNS) {
    if (pattern.test(cleanHost)) return false;
  }
  const labels = cleanHost.split(".");
  const asciiTokens = new Set();
  const cjkTokens = [];
  const cjkRe = new RegExp("[^一-鿿㐀-䶿豈-﫿]+", "g");
  for (const raw of tokens) {
    const t = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (t.length >= 2) asciiTokens.add(t);
    const stripped = String(raw).toLowerCase().replace(cjkRe, "");
    if (stripped.length >= 2) cjkTokens.push(stripped);
  }
  if (!asciiTokens.size && !cjkTokens.length) return false;
  const suffix = labels.slice(-2).join(".");
  if (ATS_VENDOR_DOMAINS.has(suffix)) return false;
  for (const label of labels) {
    if (!label || label.length < 4) continue;
    if (asciiTokens.has(label)) return true;
    for (const t of asciiTokens) {
      if (t.length < 4) continue;
      if (label.includes(t) && label.length >= t.length) return true;
    }
    if (cjkTokens.length && cjkTokens.some((token) => label.includes(token))) return true;
  }
  return false;
}




/**
 * Validate that a candidate URL really points back to the company brand.
 * Returns a normalized confidence score in [0, 1].
 */
export function scoreCandidate({ url = '', title = '', snippet = '', companyName = '' } = {}) {
  const { englishTokens, cjkOnly } = brandTokensFromCompany(companyName);
  const tokens = englishTokens.length ? englishTokens : (cjkOnly ? [cjkOnly] : []);
  const base = pickRelevant({ title, url, snippet }, { tokens, cjkToken: !englishTokens.length ? cjkOnly : '' });
  if (base <= 0) return 0;
  return Math.max(0, Math.min(1.5, base));
}

export function isCandidateOwned(url, companyName) {
  const host = hostOf(url);
  return ownedHostMatch(host, englishTokenList(companyName));
}

function englishTokenList(companyName) {
  const { englishTokens, cjkOnly } = brandTokensFromCompany(companyName);
  return englishTokens.length ? englishTokens : (cjkOnly ? [cjkOnly] : []);
}

/**
 * Build the human-facing search queries for a given company, region biased.
 */
export function queriesForCompany(companyName, { region = 'NA', limit = 4 } = {}) {
  const { query, cjkOnly } = brandTokensFromCompany(companyName);
  if (!query && !cjkOnly) return [];
  const base = region === 'CN' ? cjkOnly || query : query;
  const companyQuoted = region === 'CN' ? `"${cjkOnly || companyName}"` : `"${companyName}"`;
  const candidates = region === 'CN'
    ? [
        `${companyQuoted} ${"\u62db\u8058\u5b98\u7f51"}`,
        `${companyQuoted} ${"\u6821\u62db"} ${"\u5b98\u7f51"}`,
        `${companyQuoted} ${"\u5b9e\u4e60\u62db\u8058"} ${"\u6821\u62db\u5b98\u7f51"}`,
        `${companyQuoted} ${"\u62db\u8058"} site:mp.weixin.qq.com`,
      ]
    : [
        `${companyQuoted} careers site:jobs.lever.co OR site:job-boards.greenhouse.io OR site:jobs.ashbyhq.com OR site:myworkdayjobs.com OR site:jobs.smartrecruiters.com OR site:teamtailor.com`,
        `${companyQuoted} careers site:greenhouse.io OR site:lever.co OR site:ashbyhq.com`,
        `${companyQuoted} careers (site:linkedin.com/jobs OR site:indeed.com/viewjob)`,
        `${companyQuoted} university campus recruitment ${"\u5b98\u7f51"} OR site:linkedin.com/jobs`,
      ];
  return candidates.slice(0, Math.max(1, limit));
}

function dedupeUrls(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const u = String(item.url || '');
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(item);
  }
  return out;
}

/**
 * Run a discovery sweep for the given company. Returns:
 *   {
 *     queries: [string],
 *     candidates: [{ url, title, snippet, score, role: 'career'|'campus'|'unknown' }],
 *     careerSite?: string,
 *     campusSite?: string,
 *     provider: string,
 *   }
 */
export async function discoverCompanySites(companyName, { provider, region = 'NA', delayMs = 0, fetchItem } = {}) {
  const queries = queriesForCompany(companyName, { region });
  if (!queries.length) return { queries: [], candidates: [], provider: provider?.name ?? 'none' };
  const searches = [];
  for (const query of queries) {
    if (!provider || typeof provider.search !== 'function') break;
    const response = await provider.search(query, { limit: 10, region });
    searches.push(...((Array.isArray(response?.items) ? response.items : []).map((item) => ({ ...item, query }))));
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  const candidates = [];
  const seenHost = new Set();
  for (const item of dedupeUrls(searches)) {
    const role = (item.title + ' ' + item.snippet).match(new RegExp(CAMPUS_KEYWORDS.join('|'), 'i')) ? 'campus' : 'career';
    const score = scoreCandidate({ ...item, companyName });
    if (score <= 0) continue;
    const host = hostOf(item.url || '');
    if (!host || seenHost.has(host)) continue;
    seenHost.add(host);
    candidates.push({ url: item.url, title: item.title, snippet: item.snippet, score, role });
  }

  candidates.sort((a, b) => b.score - a.score);
  const careerSite = candidates.find((c) => c.role === 'career' && c.score >= 0.5)?.url;
  const campusSite = candidates.find((c) => c.role === 'campus' && c.score >= 0.5)?.url;

  return { queries, candidates, careerSite, campusSite, provider: provider?.name ?? 'none' };
}

// -- search provider implementations ----------------------------------

export function braveProvider({ apiKey = process.env.BRAVE_SEARCH_API_KEY, endpoint = 'https://api.search.brave.com/res/v1/web/search' } = {}) {
  if (!apiKey) return null;
  return {
    name: 'brave',
    async search(query, { limit = 10, region = 'NA', freshnessDays = 30 } = {}) {
      const params = new URLSearchParams({ q: query, count: String(Math.max(1, Math.min(20, limit))) });
      if (region === 'CN') params.set('country', 'CN');
      const days = Math.max(1, Number(freshnessDays) || 30);
      params.set('freshness', days <= 1 ? 'pd' : days <= 7 ? 'pw' : days <= 31 ? 'pm' : 'py');
      const res = await fetch(`${endpoint}?${params}`, { headers: { 'X-Subscription-Token': apiKey, accept: 'application/json' } });
      if (!res.ok) throw new Error(`brave search HTTP ${res.status}`);
      const body = await res.json();
      return { provider: 'brave', items: (body.web?.results || []).map((item) => ({ title: item.title, url: item.url, snippet: item.description })) };
    },
  };
}

export function tavilyProvider({ apiKey = process.env.TAVILY_API_KEY, endpoint = 'https://api.tavily.com/search', searchDepth = process.env.TAVILY_SEARCH_DEPTH || 'basic' } = {}) {
  if (!apiKey) return null;
  return {
    name: 'tavily',
    async search(query, { limit = 10, region = 'NA', freshnessDays = 30, domains = [] } = {}) {
      const days = Math.max(1, Number(freshnessDays) || 30);
      const body = {
        query, search_depth: searchDepth === 'advanced' ? 'advanced' : 'basic', topic: 'general', max_results: Math.max(1, Math.min(20, limit)),
        include_answer: false, include_raw_content: false,
        time_range: days <= 1 ? 'day' : days <= 7 ? 'week' : days <= 31 ? 'month' : 'year',
      };
      if (region === 'CN') body.country = 'china';
      if (Array.isArray(domains) && domains.length) body.include_domains = domains;
      const res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`tavily search HTTP ${res.status}`);
      const payload = await res.json();
      return { provider: 'tavily', items: (payload.results || []).map((item) => ({ title: item.title, url: item.url, snippet: item.content, publishedAt: item.published_date ? Date.parse(item.published_date) : undefined })) };
    },
  };
}

export function duckDuckGoProvider({ apiKey = process.env.DUCKDUCKGO_SEARCH_API_KEY, endpoint = 'https://api.duckduckgo.com/' } = {}) {
  if (!apiKey) return null;
  return {
    name: 'duckduckgo',
    async search(query, { limit = 10 } = {}) {
      const params = new URLSearchParams({ q: query, format: 'json', no_html: '1', skip_disambig: '1' });
      const res = await fetch(`${endpoint}?${params}`, { headers: { authorization: `Bearer ${apiKey}` } });
      if (!res.ok) throw new Error(`duckduckgo search HTTP ${res.status}`);
      const body = await res.json();
      const topics = (body.RelatedTopics || []).slice(0, limit);
      return { provider: 'duckduckgo', items: topics.filter((t) => t.FirstURL).map((t) => ({ title: t.Text, url: t.FirstURL, snippet: t.Text })) };
    },
  };
}

export function stubProvider() {
  return {
    name: 'stub',
    async search() { return { provider: 'stub', items: [] }; },
  };
}

export function createDefaultSearchProvider({ braveKey, tavilyKey, duckKey } = {}) {
  return braveProvider({ apiKey: braveKey }) || tavilyProvider({ apiKey: tavilyKey }) || duckDuckGoProvider({ apiKey: duckKey }) || stubProvider();
}
