import { createHash } from 'node:crypto';
import { officialQueries, scoreOfficialCandidate } from './cn-official-search.mjs';
import { classifyRecruitmentUrl, isOfficialApplyChannel } from './official-links.mjs';

const API = 'https://api.apify.com/v2';
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*[~/][A-Za-z0-9][A-Za-z0-9_.-]*$/;
const organic = (item = {}) => item.organicResults || item.organic_results || item.results || item.items || [];
const safeNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const chinaDay = (time = Date.now()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
const chinaMonth = (time = Date.now()) => chinaDay(time).slice(0, 7);
const cleanError = (error) => String(error?.message || error || '').replace(/(?:authorization|bearer|api[_-]?key|token)\s*[:=]?\s*[^\s,;]+/gi, '[REDACTED]').slice(0, 240);
const canonical = (url = '') => { try { const value = new URL(url); value.hash = ''; return value.href; } catch { return ''; } };
const actorPath = (actorId = '') => { if (!ACTOR_ID.test(actorId)) throw new Error('Apify actor id must be owner/actor'); return actorId.replace('/', '~'); };

export function apifyConfig(env = process.env) {
  return {
    token: env.APIFY_TOKEN || '',
    googleActorId: env.APIFY_GOOGLE_SEARCH_ACTOR_ID || 'scrapemesh/google-search-results-scraper',
    rawHttpActorId: env.APIFY_RAW_HTTP_ACTOR_ID || '',
    browserActorId: env.APIFY_BROWSER_ACTOR_ID || '',
    dailyBudgetUsd: safeNumber(env.APIFY_DAILY_BUDGET_USD, 0.50),
    monthlyBudgetUsd: safeNumber(env.APIFY_MONTHLY_BUDGET_USD, 4.50),
    runMaxChargeUsd: safeNumber(env.APIFY_RUN_MAX_CHARGE_USD, 0.50),
    maxQueriesPerCampaign: Math.max(1, Math.min(3, safeNumber(env.APIFY_SEARCH_MAX_QUERIES_PER_CAMPAIGN, 3))),
    maxPagesPerQuery: Math.max(1, Math.min(1, safeNumber(env.APIFY_GOOGLE_MAX_PAGES_PER_QUERY ?? env.APIFY_SEARCH_MAX_PAGES_PER_QUERY, 1))),
    maxResults: Math.max(1, Math.min(8, safeNumber(env.APIFY_SEARCH_MAX_RESULTS ?? env.SEARCH_MAX_RESULTS, 8))),
    campaignCacheTtlDays: safeNumber(env.APIFY_SEARCH_CACHE_TTL_DAYS, 14),
    companyDomainCacheTtlDays: safeNumber(env.APIFY_COMPANY_DOMAIN_CACHE_TTL_DAYS, 60),
    failedCacheTtlDays: safeNumber(env.APIFY_FAILED_SEARCH_CACHE_TTL_DAYS, 3),
    batchQueryLimit: Math.max(5, Math.min(100, safeNumber(env.APIFY_SEARCH_BATCH_QUERY_LIMIT, 50))),
    runTimeoutSeconds: Math.max(30, Math.min(600, safeNumber(env.APIFY_RUN_TIMEOUT_SECONDS, 90))),
    requestTimeoutMs: Math.max(5000, Math.min(60000, safeNumber(env.APIFY_REQUEST_TIMEOUT_MS, 30000))),
    allowResidentialProxy: String(env.APIFY_ALLOW_RESIDENTIAL_PROXY || 'false').toLowerCase() === 'true',
    proxyMode: String(env.APIFY_PROXY_MODE || 'none').toLowerCase(),
  };
}

export function apifySearchInput(queries, config = apifyConfig()) {
  const proxyConfiguration = config.allowResidentialProxy && config.proxyMode === 'residential'
    ? { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] }
    : config.proxyMode === 'datacenter'
      ? { useApifyProxy: true, apifyProxyGroups: ['DATACENTER'] }
      : { useApifyProxy: false };
  return {
    queries: queries.join('\n'),
    resultsPerPage: config.maxResults,
    maxPagesPerQuery: config.maxPagesPerQuery,
    aiMode: 'aiModeOff',
    includeUnfilteredResults: false,
    includeAds: false,
    focusOnPaidAds: false,
    includeAiOverview: false,
    includePeopleAlsoAsk: false,
    includeImages: false,
    includeMaps: false,
    saveHtml: false,
    saveHtmlToKeyValueStore: false,
    includeIcons: false,
    mobileResults: false,
    proxyConfiguration,
  };
}

export function createApifyCostReport(ledger = {}, config = apifyConfig(), now = Date.now()) {
  const day = chinaDay(now), month = chinaMonth(now), runs = Array.isArray(ledger.runs) ? ledger.runs : [];
  const daily = runs.filter((run) => run.localDay === day), monthly = runs.filter((run) => run.localMonth === month);
  const sum = (items, field) => items.reduce((total, item) => total + safeNumber(item[field]), 0);
  const by = (items, field) => Object.fromEntries(Object.entries(items.reduce((out, item) => { const key = item[field] || 'unknown'; out[key] = (out[key] || 0) + safeNumber(item.usage_total_usd); return out; }, {})).map(([key, value]) => [key, Number(value.toFixed(6))]));
  const queryCount = sum(monthly, 'query_count'), officialCandidates = sum(monthly, 'official_candidate_count'), verified = sum(monthly, 'verified_campaign_count');
  const dailyCost = sum(daily, 'usage_total_usd'), monthlyCost = sum(monthly, 'usage_total_usd');
  return {
    generated_at: new Date(now).toISOString(), daily_cost_usd: Number(dailyCost.toFixed(6)), monthly_cost_usd: Number(monthlyCost.toFixed(6)),
    cost_by_actor: by(monthly, 'actor_id'), cost_by_source: by(monthly, 'source'),
    cost_per_query: queryCount ? Number((monthlyCost / queryCount).toFixed(6)) : null,
    cost_per_official_candidate: officialCandidates ? Number((monthlyCost / officialCandidates).toFixed(6)) : null,
    cost_per_verified_campaign: verified ? Number((monthlyCost / verified).toFixed(6)) : null,
    cache_savings_estimate: Number(sum(monthly, 'cache_savings_estimate').toFixed(6)),
    budget_remaining: { daily_usd: Number(Math.max(0, config.dailyBudgetUsd - dailyCost).toFixed(6)), monthly_usd: Number(Math.max(0, config.monthlyBudgetUsd - monthlyCost).toFixed(6)) },
    blocked_by_budget_count: monthly.filter((run) => run.status === 'search_deferred_by_budget').length,
  };
}

function cacheKey(project = {}) { return createHash('sha1').update(`${project.projectId || ''}|${project.company || ''}|${project.cohortYear || ''}|${project.recruitmentType || ''}`).digest('hex'); }
function cacheEntryValid(entry, now = Date.now()) { return entry && Date.parse(entry.expiresAt) > now; }

export function prioritizeApifyProjects(projects = [], { scope = 'all' } = {}) {
  const text = (project) => [project.recruitmentType, project.jobType, project.projectName, project.title, ...(project.jobTitles || [])].filter(Boolean).join(' ');
  const isInternship = (project) => /实习|intern/i.test(text(project));
  const isSummer = (project) => /暑期|summer/i.test(text(project));
  const timestamp = (project) => Number(project.postedAt || project.updatedAt || project.firstSeenAt || 0);
  return projects
    .filter((project) => scope !== 'internship' || isInternship(project))
    .sort((left, right) => Number(isSummer(right)) - Number(isSummer(left)) || timestamp(right) - timestamp(left));
}

export function directOfficialCandidates(project = {}) {
  const values = [
    ['finalApplyUrl', project.finalApplyUrl], ['applyUrl', project.applyUrl],
    ['officialApplyUrl', project.officialApplyUrl], ['officialUrl', project.officialUrl],
    ['announcementUrl', project.announcementUrl], ['officialDetailUrl', project.officialDetailUrl],
    ...(project.sourceLinks || []).map((link) => [link.linkType || 'source_link', link.url]),
  ];
  const seen = new Set(), candidates = [];
  for (const [field, value] of values) {
    const classified = classifyRecruitmentUrl(value);
    if (!classified.url || !isOfficialApplyChannel(classified.channel) || seen.has(classified.url)) continue;
    seen.add(classified.url);
    candidates.push({ provider: 'source_direct', discoveryMethod: 'source_direct', sourceField: field, url: classified.url, normalizedUrl: classified.url, domain: new URL(classified.url).hostname.toLowerCase(), title: `${project.company || ''} 校园招聘 官方招聘入口`, snippet: `${project.company || ''} ${project.cohortYear ? `${project.cohortYear}届` : ''} ${project.recruitmentType || ''}；聚合来源字段 ${field} 直接提供`, rank: candidates.length + 1 });
  }
  return candidates;
}

export function selectApifySearchProjects(projects = [], cache = {}, config = apifyConfig(), now = Date.now()) {
  const ready = [], deferred = [], cacheHits = [], directHits = [];
  for (const project of projects) {
    const key = cacheKey(project), entry = cache[key];
    if (project.officialVerified === true && project.applicationActive !== false) { deferred.push({ project, reason: 'active_verified' }); continue; }
    const direct = directOfficialCandidates(project);
    if (direct.length) { directHits.push({ project, candidates: direct }); continue; }
    if (cacheEntryValid(entry, now) && entry.status === 'success' && Array.isArray(entry.candidates)) { cacheHits.push({ project, entry }); continue; }
    if (!project.company || !project.projectId) { deferred.push({ project, reason: 'invalid_project' }); continue; }
    ready.push({ project, key });
  }
  return { ready, deferred, cacheHits, directHits };
}

function normalizeDataset(items = [], queries = [], maxResults = 8) {
  const output = new Map();
  for (let index = 0; index < items.length; index++) {
    const page = items[index] || {}, rawQuery = page.searchQuery || page.query || page.searchTerm || page.searchQueryTerm || '', query = typeof rawQuery === 'object' ? (rawQuery.term || rawQuery.query || rawQuery.text || queries[index] || '') : (rawQuery || queries[index] || '');
    for (const [rank, result] of organic(page).slice(0, maxResults).entries()) {
      const url = canonical(result.url || result.link || result.destinationUrl || '');
      if (!url) continue;
      const candidate = { provider: 'apify_google', query, rank: safeNumber(result.position || result.rank, rank + 1), title: result.title || result.name || '', url, normalizedUrl: url, domain: new URL(url).hostname.toLowerCase(), snippet: result.description || result.snippet || result.text || '' };
      output.set(`${query}|${url}`, candidate);
    }
  }
  return [...output.values()];
}

export class ApifyGoogleSearchProvider {
  constructor({ env = process.env, ledger = { runs: [] }, cache = {}, fetcher = fetch, now = () => Date.now() } = {}) { this.config = apifyConfig(env); this.ledger = ledger; this.cache = cache; this.fetcher = fetcher; this.now = now; this.providerName = 'apify_google'; }
  isConfigured() { return Boolean(this.config.token); }
  budgetReport() { return createApifyCostReport(this.ledger, this.config, this.now()); }
  canSpend() { const remaining = this.budgetReport().budget_remaining; return Math.min(remaining.daily_usd, remaining.monthly_usd, this.config.runMaxChargeUsd) > 0; }
  async request(path, init = {}) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs); try { const response = await this.fetcher(`${API}${path}`, { ...init, signal: controller.signal, headers: { accept: 'application/json', authorization: `Bearer ${this.config.token}`, ...(init.headers || {}) } }); if (!response.ok) throw new Error(`Apify HTTP ${response.status}`); return response.json(); } finally { clearTimeout(timer); } }
  async runBatch(queries = [], { source = 'official_search', verifiedCampaignCount = 0 } = {}) {
    const started = this.now(), unique = [...new Set(queries.filter(Boolean))].slice(0, 100);
    if (!this.isConfigured()) return { status: 'not_configured', candidates: [], queries: unique, cacheHits: 0 };
    if (!unique.length) return { status: 'success', candidates: [], queries: [], cacheHits: 0 };
    if (!this.canSpend()) { const record = { status: 'search_deferred_by_budget', localDay: chinaDay(started), localMonth: chinaMonth(started), source, actor_id: this.config.googleActorId, query_count: unique.length, usage_total_usd: 0, cache_savings_estimate: 0 }; this.ledger.runs ||= []; this.ledger.runs.push(record); return { status: 'search_deferred_by_budget', candidates: [], queries: unique, deferred: true }; }
    let run;
    try {
      const params = new URLSearchParams({ maxTotalChargeUsd: String(Math.min(this.config.runMaxChargeUsd, this.budgetReport().budget_remaining.daily_usd, this.budgetReport().budget_remaining.monthly_usd)), restartOnError: 'false', timeout: String(this.config.runTimeoutSeconds) });
      const startedRun = await this.request(`/acts/${actorPath(this.config.googleActorId)}/runs?${params}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(apifySearchInput(unique, this.config)) });
      run = startedRun.data;
      if (!run?.id) throw new Error('Apify did not return run id');
      const deadline = Date.now() + this.config.runTimeoutSeconds * 1000;
      while (Date.now() < deadline) { const status = await this.request(`/actor-runs/${run.id}`); run = status.data; if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(run.status)) break; await new Promise((resolve) => setTimeout(resolve, 2_000)); }
      if (run.status !== 'SUCCEEDED') throw new Error(`Apify run ${run.status || 'TIMED-OUT'}`);
      const dataset = await this.request(`/actor-runs/${run.id}/dataset/items?clean=true`);
      const candidates = normalizeDataset(dataset, unique, this.config.maxResults);
      const usage = safeNumber(run.usageTotalUsd ?? run.usageUsd);
      const record = { status: 'success', localDay: chinaDay(started), localMonth: chinaMonth(started), source, actor_id: this.config.googleActorId, run_id: run.id, dataset_id: run.defaultDatasetId || '', query_count: unique.length, search_result_pages: Array.isArray(dataset) ? dataset.length : 0, candidate_url_count: candidates.length, cache_hit_count: 0, usage_total_usd: usage, official_candidate_count: 0, verified_campaign_count: verifiedCampaignCount, cache_savings_estimate: 0 };
      this.ledger.runs ||= []; this.ledger.runs.push(record);
      return { status: 'success', candidates, queries: unique, run: record };
    } catch (error) { const record = { status: 'provider_error', localDay: chinaDay(started), localMonth: chinaMonth(started), source, actor_id: this.config.googleActorId, run_id: run?.id || '', dataset_id: run?.defaultDatasetId || '', query_count: unique.length, usage_total_usd: safeNumber(run?.usageTotalUsd), error: cleanError(error), cache_savings_estimate: 0 }; this.ledger.runs ||= []; this.ledger.runs.push(record); return { status: 'provider_error', candidates: [], queries: unique, errorCode: record.error }; }
  }
}

export function updateApifyCampaignCache(cache, project, result, config = apifyConfig(), now = Date.now()) {
  if (result.status !== 'success') return cache;
  const ttl = result.status === 'success' && (result.candidates || []).length ? config.campaignCacheTtlDays : config.failedCacheTtlDays;
  cache[cacheKey(project)] = { expiresAt: new Date(now + ttl * 86_400_000).toISOString(), status: result.status, candidateCount: (result.candidates || []).length, candidates: (result.candidates || []).slice(0, 24), projectId: project.projectId };
  return cache;
}

export function updateApifyCompanyDomainCache(cache, project, candidates = [], config = apifyConfig(), now = Date.now()) {
  const key = String(project.companyStandardId || project.company || '').trim().toLowerCase();
  if (!key) return cache;
  const domains = [...new Set(candidates.filter((candidate) => isOfficialApplyChannel(classifyRecruitmentUrl(candidate.url).channel)).map((candidate) => candidate.domain).filter(Boolean))];
  if (domains.length) cache[key] = { expiresAt: new Date(now + config.companyDomainCacheTtlDays * 86_400_000).toISOString(), domains, projectId: project.projectId };
  return cache;
}

export async function runApifyCampaignSearch(projects, { provider, cache = {}, domainCache = {}, config = provider?.config || apifyConfig(), limit = 100, now = Date.now() } = {}) {
  const selection = selectApifySearchProjects(projects, cache, config, now);
  const planned = selection.ready.slice(0, Math.max(1, limit)).map(({ project }) => ({ project, queries: officialQueries(project, { limit: config.maxQueriesPerCampaign }) }));
  const accumulated = new Map(planned.map(({ project }) => [project.projectId, []]));
  const runs = [];
  let active = [...planned], terminalStatus = active.length ? 'success' : 'skipped';
  // Query in rounds: every Actor Run contains many companies, while a company
  // with a high-confidence hit is removed before the next query is submitted.
  for (let round = 0; round < config.maxQueriesPerCampaign && active.length; round++) {
    const roundItems = active.filter((item) => item.queries[round]);
    const next = [];
    for (let offset = 0; offset < roundItems.length; offset += config.batchQueryLimit) {
      const chunk = roundItems.slice(offset, offset + config.batchQueryLimit);
      const result = await provider.runBatch(chunk.map((item) => item.queries[round]), { source: 'official_search' });
      if (result.run) runs.push(result.run);
      if (result.status !== 'success') { terminalStatus = result.status; for (const item of chunk) next.push(item); continue; }
      for (const item of chunk) {
        const found = (result.candidates || []).filter((candidate) => candidate.query === item.queries[round]);
        accumulated.get(item.project.projectId).push(...found);
        // A strong recall candidate is enough to stop spending on more query
        // variants, but it is still only a candidate. Identity verification is
        // performed later and this path never writes applicationUrl.
        const confident = found.some((candidate) => {
          const score = scoreOfficialCandidate(candidate, item.project);
          return score.hardRejectReasons.length === 0 && score.totalScore >= 75 && ['official_ats', 'official_career_site'].includes(score.classification);
        });
        if (!confident) next.push(item);
      }
    }
    active = next;
    if (terminalStatus !== 'success') break;
  }
  const byProject = planned.map(({ project, queries }) => {
    const candidates = accumulated.get(project.projectId) || [];
    const status = terminalStatus === 'success' ? 'success' : candidates.length ? 'partial_success' : terminalStatus;
    if (candidates.length) updateApifyCampaignCache(cache, project, { status: 'success', candidates }, config, now);
    if (candidates.length) updateApifyCompanyDomainCache(domainCache, project, candidates, config, now);
    return { projectId: project.projectId, company: project.company, queryCount: Math.min(queries.length, candidates.length ? 1 + Math.max(...candidates.map((candidate) => queries.indexOf(candidate.query))) : queries.length), candidates, status };
  });
  for (const { project, candidates } of selection.directHits) updateApifyCompanyDomainCache(domainCache, project, candidates, config, now);
  // When a paid search batch is running, keep direct-source hits in the cache
  // and report their count, but do not send hundreds of already-known links
  // through the sequential verification loop in the CLI. A direct-only run
  // still returns the hit rows for local verification and auditing.
  if (!planned.length) byProject.unshift(...selection.directHits.map(({ project, candidates }) => ({ projectId: project.projectId, company: project.company, queryCount: 0, candidates, status: 'direct_source_hit' })));
  const savedQueries = [...selection.cacheHits, ...selection.directHits].reduce((count, item) => count + officialQueries(item.project, { limit: config.maxQueriesPerCampaign }).length, 0);
  if (runs.length) runs.at(-1).cache_savings_estimate = Number((savedQueries * (config.runMaxChargeUsd / Math.max(1, runs.reduce((sum, run) => sum + run.query_count, 0)))).toFixed(6));
  const partial = [...accumulated.values()].some((items) => items.length > 0);
  const status = planned.length ? (terminalStatus === 'success' ? 'success' : partial ? 'partial_success' : terminalStatus) : selection.directHits.length ? 'success' : 'skipped';
  return { status, projects: byProject, directSourceHits: selection.directHits.length, cacheHits: selection.cacheHits.length, deferred: selection.deferred.map((item) => ({ projectId: item.project.projectId, reason: item.reason })), runs, run: runs[0] || null };
}

export async function apifyFetchFallback(url, { localHttpFailed = false, localPlaywrightFailed = false, tier = 'raw_http', env = process.env } = {}) {
  const config = apifyConfig(env);
  if (!localHttpFailed || !localPlaywrightFailed) return { status: 'not_needed', strategy: 'local_http→local_playwright' };
  const actorId = tier === 'browser' ? config.browserActorId : config.rawHttpActorId;
  if (!config.token || !actorId) return { status: 'manual_review', strategy: `local_http→local_playwright→apify_${tier}→manual_review` };
  return { status: 'requires_explicit_actor_adapter', actorId, strategy: `local_http→local_playwright→apify_${tier}→manual_review`, url, residentialProxyAllowed: config.allowResidentialProxy };
}
