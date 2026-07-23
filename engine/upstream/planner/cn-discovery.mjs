import path from 'node:path';
import { makeHttpCtx } from '../providers/_http.mjs';
import { loadProviders } from '../providers/_registry.mjs';
import { dedupeJobs, normalizeJob } from './core.mjs';
import { createDefaultSearchProvider } from './site-discovery.mjs';
import { runCnIndexDiscovery } from './cn-index-discovery.mjs';
import { inferOrganizationType } from './cn-source-catalog.mjs';
import { verifyOfficialRecruitmentProject } from './cn-recruitment-project.mjs';
import { archiveSourceDocument } from './cn-source-document-store.mjs';

export const DEFAULT_CN_SOURCES = ['nowcoder-schedule', 'niuqizhipin', 'gank-interview', 'search-indexes', 'bytedance', 'tencent'];
const SOURCE_META = {
  'nowcoder-schedule': { name: '牛客校招日程', careers_url: 'https://www.nowcoder.com/jobs/school/schedule?tab=3', source: 'NowCoder Schedule', sourceType: 'discovery_index' },
  niuqizhipin: { name: '牛企直聘', careers_url: 'https://campus.niuqizp.com/scheduleintern-1/', source: '牛企直聘', sourceType: 'aggregator' },
  'gank-interview': { name: 'Gank Interview', careers_url: 'https://www.gankinterview.cn/campus?tab=latest&size=50&sort=updated&order=desc&page=1', source: 'Gank Interview', sourceType: 'aggregator' },
  'search-indexes': { name: '多平台搜索索引', careers_url: 'https://www.nuc.ncss.cn/', source: 'Search Indexes', sourceType: 'discovery_index' },
  nowcoder: { name: '牛客', careers_url: 'https://www.nowcoder.com/jobs/school/jobs', source: 'NowCoder', sourceType: 'job_board' },
  bytedance: { name: '字节跳动', careers_url: 'https://jobs.bytedance.com/campus/position', source: 'ByteDance Careers', sourceType: 'official_company', organizationType: '其他企业' },
  tencent: { name: '腾讯', careers_url: 'https://careers.tencent.com/search.html', source: 'Tencent Careers', sourceType: 'official_company', organizationType: '其他企业' },
  yingjiesheng: { name: '应届生求职网', careers_url: 'https://www.yingjiesheng.com/job-1-0-0-0-0-1.html', source: 'YingJieSheng', sourceType: 'job_board' },
};

export function normalizeCnSources(value) {
  const requested = Array.isArray(value) ? value : String(value || '').split(',');
  const clean = requested.map((item) => String(item).trim().toLowerCase()).filter((item) => SOURCE_META[item]);
  return [...new Set(clean.length ? clean : DEFAULT_CN_SOURCES)];
}

function roleKeywords(plan) {
  if (plan?.roleProfile === 'broad') return [''];
  const seen = new Set();
  const preferred = (plan?.roles || []).filter((role) => /[\u3400-\u9fff]|ios|swift|java|python|c\+\+|ai|data/i.test(role));
  const fallback = plan?.roles || [];
  return [...preferred, ...fallback].filter((role) => {
    const key = String(role || '').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 18);
}

export function filterRecentCnJobs(jobs, { sinceDays = 30, includeUndated = false, now = Date.now() } = {}) {
  const cutoff = now - Math.max(1, Number(sinceDays) || 30) * 86_400_000;
  const accepted = [];
  let droppedOld = 0;
  let droppedUndated = 0;
  for (const job of jobs) {
    const postedAt = Number(job?.postedAt);
    if (!Number.isFinite(postedAt) || postedAt <= 0) {
      if (includeUndated) accepted.push(job);
      else droppedUndated++;
    } else if (postedAt < cutoff) droppedOld++;
    else accepted.push(job);
  }
  return { accepted, droppedOld, droppedUndated };
}

export async function runCnDiscovery({
  rootDir,
  plan,
  sources = DEFAULT_CN_SOURCES,
  sinceDays = 30,
  limit = 100,
  maxPages = 3,
  includeUndated = false,
  providers = null,
  ctx = null,
  searchProvider = null,
  indexSources = null,
  indexQueryLimit = 10,
  indexCompanyLimit = 80,
  indexDelayMs = 0,
  recruitTypes = [1, 2, 3],
  resolveOfficial = false,
  verifyOfficial = false,
  officialFetcher,
  officialResolutionCache = {},
  now = Date.now(),
} = {}) {
  const selectedSources = normalizeCnSources(sources);
  const providerMap = providers || await loadProviders(path.join(rootDir, 'providers'));
  const httpCtx = { ...(ctx || makeHttpCtx()), maxPages: Math.max(1, Math.min(100, Number(maxPages) || 3)) };
  const keywords = roleKeywords(plan);
  const collected = [];
  const campaigns = [];
  const unresolvedCampaigns = [];
  const indexLeads = [];
  const sourceDiagnostics = [];

  for (const sourceId of selectedSources) {
    const meta = SOURCE_META[sourceId];
    if (sourceId === 'search-indexes') {
      try {
        const result = await runCnIndexDiscovery({
          plan, searchProvider: searchProvider || createDefaultSearchProvider(), sources: indexSources,
          sinceDays, queryLimit: indexQueryLimit, companyLimit: indexCompanyLimit,
          delayMs: indexDelayMs, resolutionCache: officialResolutionCache, resolveOfficial, now,
          verifyOfficial, fetcher: officialFetcher, archiveDocument: (document, options) => archiveSourceDocument(rootDir, document, options),
        });
        officialResolutionCache = result.resolutionCache || officialResolutionCache;
        campaigns.push(...result.campaigns);
        unresolvedCampaigns.push(...result.pending);
        indexLeads.push(...result.leads);
        sourceDiagnostics.push({ source: sourceId, status: result.status, provider: result.provider, fetched: result.leads.length, accepted: result.campaigns.length, pendingOfficialResolution: result.pending.length, companiesResolved: result.companiesResolved || 0 });
      } catch (error) {
        sourceDiagnostics.push({ source: sourceId, status: 'error', error: error.message, fetched: 0, accepted: 0 });
      }
      continue;
    }
    const provider = providerMap.get(sourceId);
    if (!provider) {
      sourceDiagnostics.push({ source: sourceId, status: 'error', error: 'provider not found', fetched: 0 });
      continue;
    }
    const entry = {
      name: meta.name,
      provider: sourceId,
      careers_url: meta.careers_url,
      keywords,
      max_pages: httpCtx.maxPages,
      since_days: sinceDays,
      recruit_types: recruitTypes,
    };
    try {
      const rawJobs = await provider.fetch(entry, httpCtx);
      if (sourceId === 'nowcoder-schedule') {
        const recent = filterRecentCnJobs(rawJobs, { sinceDays, includeUndated, now });
        const prepared = recent.accepted.map((item) => ({ ...item, organizationType: item.organizationType || inferOrganizationType({ title: item.title || item.batchName, snippet: item.description, company: item.company }) }));
        const checked = [];
        for (const item of prepared) {
          if (verifyOfficial && item.officialUrl) checked.push(await verifyOfficialRecruitmentProject(item, { fetcher: officialFetcher, now, archiveDocument: (document, options) => archiveSourceDocument(rootDir, document, options) }));
          else checked.push(item);
        }
        campaigns.push(...checked);
        sourceDiagnostics.push({
          source: sourceId, status: 'ok', fetched: rawJobs.length, accepted: recent.accepted.length,
          officialResolved: checked.filter((item) => item.officialVerified).length,
          officialWechat: checked.filter((item) => item.officialChannel === 'official_wechat').length,
          pendingOfficialResolution: checked.filter((item) => !item.officialVerified).length,
          droppedOld: recent.droppedOld, droppedUndated: recent.droppedUndated,
        });
        continue;
      }
      const normalized = rawJobs.map((job) => normalizeJob({
        ...job,
        marketRegion: 'CN',
        source: meta.source,
        sourceType: meta.sourceType,
        platform: sourceId,
        sourceUrl: job.url,
        organizationType: job.organizationType || meta.organizationType || inferOrganizationType({ title: job.title, snippet: job.description, company: job.company }),
        livenessStatus: meta.sourceType === 'official_company' ? 'active' : job.livenessStatus,
        livenessReason: meta.sourceType === 'official_company' ? '本次运行仍由公司官方招聘接口列出' : job.livenessReason,
        lastVerifiedAt: meta.sourceType === 'official_company' ? now : job.lastVerifiedAt,
      }));
      const recent = filterRecentCnJobs(normalized, { sinceDays, includeUndated, now });
      collected.push(...recent.accepted);
      sourceDiagnostics.push({
        source: sourceId,
        status: 'ok',
        fetched: rawJobs.length,
        accepted: recent.accepted.length,
        droppedOld: recent.droppedOld,
        droppedUndated: recent.droppedUndated,
      });
    } catch (error) {
      sourceDiagnostics.push({ source: sourceId, status: 'error', error: error.message, fetched: 0, accepted: 0 });
    }
  }

  const offers = dedupeJobs(collected, { region: 'CN' })
    .sort((a, b) => Number(b.postedAt || 0) - Number(a.postedAt || 0))
    .slice(0, Math.max(1, Math.min(5000, Number(limit) || 100)));
  return {
    offers,
    campaigns: campaigns.sort((a, b) => Number(b.postedAt || 0) - Number(a.postedAt || 0)),
    unresolvedCampaigns: [...campaigns.filter((item) => item.needsOfficialLink), ...unresolvedCampaigns],
    indexLeads,
    officialResolutionCache,
    marketRegion: 'CN',
    sourcesRequested: selectedSources.length,
    sourcesSucceeded: sourceDiagnostics.filter((item) => item.status === 'ok').length,
    sourcesFailed: sourceDiagnostics.filter((item) => item.status === 'error').length,
    postingsDroppedNoDate: sourceDiagnostics.reduce((sum, item) => sum + Number(item.droppedUndated || 0), 0),
    postingsDroppedOld: sourceDiagnostics.reduce((sum, item) => sum + Number(item.droppedOld || 0), 0),
    diagnostics: sourceDiagnostics,
  };
}
