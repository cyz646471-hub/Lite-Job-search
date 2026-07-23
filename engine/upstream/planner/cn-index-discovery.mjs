import { buildCnIndexQueries, inferOrganizationType, sourceForUrl, sourceClassification } from './cn-source-catalog.mjs';
import { classifyRecruitmentUrl } from './official-links.mjs';
import { discoverCompanySites } from './site-discovery.mjs';
import { verifyOfficialRecruitmentProject } from './cn-recruitment-project.mjs';

const COMPANY_SUFFIXES = /(?:股份有限公司|有限责任公司|有限公司|集团|银行|证券|研究院|研究所|事务所|学校|医院)/;
const PLATFORM_NAMES = /(?:实习僧|应届生求职网|BOSS直聘|智联招聘|国家大学生就业服务平台)/gi;

export function inferCompanyFromSearchItem(item = {}) {
  const text = `${item.title || ''} ${item.snippet || ''}`.replace(PLATFORM_NAMES, ' ').replace(/[｜|_—–]+/g, ' ');
  const legal = text.match(new RegExp(`([\u3400-\u9fffA-Za-z0-9·（）()\-]{2,40}${COMPANY_SUFFIXES.source})`));
  if (legal) return legal[1].trim();
  const parts = String(item.title || '').split(/[-｜|_—–]/).map((part) => part.trim()).filter(Boolean);
  const candidate = parts.find((part) => /[\u3400-\u9fff]/.test(part) && !/(招聘|校招|实习|岗位|职位|工程师|求职)/.test(part));
  return candidate?.slice(0, 40) || '';
}

function dedupe(items, keyFn) {
  const seen = new Set();
  return items.filter((item) => { const key = keyFn(item); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}

export async function runCnIndexDiscovery({ plan = {}, searchProvider, sources, sinceDays = 30, queryLimit = 10, companyLimit = 80, delayMs = 0, resolutionCache = {}, cacheTtlDays = 14, resolveOfficial = false, verifyOfficial = false, fetcher, archiveDocument, now = Date.now() } = {}) {
  if (!searchProvider || searchProvider.name === 'stub' || typeof searchProvider.search !== 'function') {
    return { leads: [], campaigns: [], pending: [], queries: [], provider: 'none', status: 'not_configured', resolutionCache };
  }
  const queries = buildCnIndexQueries(plan.roles || [], { sources });
  const raw = [];
  for (const spec of queries) {
    const response = await searchProvider.search(spec.query, { limit: queryLimit, region: 'CN', freshnessDays: sinceDays, domains: spec.domains });
    for (const item of response?.items || []) raw.push({ ...item, discoverySource: spec.sourceName, query: spec.query });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  const leads = dedupe(raw, (item) => item.url).map((item) => {
    const source = sourceForUrl(item.url);
    return {
      recordType: 'index_lead', title: String(item.title || '').trim(), company: inferCompanyFromSearchItem(item),
      indexUrl: item.url, sourceUrl: item.url, url: item.url, source: source.name, sourceId: source.id, sourceType: sourceClassification(source.id),
      snippet: String(item.snippet || ''), query: item.query, discoveredAt: now,
      organizationType: inferOrganizationType({ sourceId: source.id, title: item.title, snippet: item.snippet, company: inferCompanyFromSearchItem(item) }),
      postedAt: Number(item.publishedAt) || now, dateBasis: item.publishedAt ? 'source_date' : 'first_seen',
    };
  });
  if (!resolveOfficial) return { leads, campaigns: [], pending: [], queries, provider: searchProvider.name, status: 'ok', companiesResolved: 0, resolutionCache };
  const companyCache = new Map();
  const campaigns = [];
  const pending = [];
  for (const lead of leads) {
    if (!lead.company || companyCache.size >= companyLimit) { pending.push({ ...lead, needsOfficialLink: true, resolutionReason: lead.company ? 'company limit reached' : 'company could not be inferred' }); continue; }
    if (!companyCache.has(lead.company)) {
      const cached = resolutionCache[lead.company];
      if (cached?.result && Number(cached.expiresAt) > now) companyCache.set(lead.company, cached.result);
      else {
        const result = await discoverCompanySites(lead.company, { provider: searchProvider, region: 'CN', delayMs });
        companyCache.set(lead.company, result);
        resolutionCache[lead.company] = { checkedAt: now, expiresAt: now + Math.max(1, Number(cacheTtlDays) || 14) * 86_400_000, result };
      }
    }
    const discovery = companyCache.get(lead.company);
    const officialUrl = discovery.campusSite || discovery.careerSite || '';
    const classification = classifyRecruitmentUrl(officialUrl);
    if (!officialUrl || classification.rank < 2) {
      pending.push({ ...lead, officialCandidates: discovery.candidates || [], needsOfficialLink: true, resolutionReason: 'official site not confirmed' });
      continue;
    }
    const candidate = {
      ...lead, campaignId: `search-${lead.sourceId}-${Buffer.from(lead.indexUrl).toString('base64url').slice(0, 24)}`,
      recordType: 'recruitment_campaign', officialUrl: classification.url, officialChannel: classification.channel,
      url: classification.url, applyUrl: classification.url, needsOfficialLink: true,
      discoveryEvidence: [{ source: lead.source, url: lead.indexUrl, query: lead.query }],
      contentHash: [lead.title, lead.snippet, classification.url].join('|'),
    };
    // Search finds a candidate official site; it does not validate the
    // campaign. Only a successful low-rate visit can promote the lead.
    const checked = verifyOfficial ? await verifyOfficialRecruitmentProject(candidate, { fetcher, now, archiveDocument }) : candidate;
    if (delayMs > 0 && verifyOfficial) await new Promise((resolve) => setTimeout(resolve, delayMs));
    // Keep the structured campaign candidate for audit and database merging.
    // Its `officialVerified` flag, rather than its presence here, controls
    // whether it is promoted to the confirmed project list.
    campaigns.push({ ...checked, needsOfficialLink: !checked.officialVerified, resolutionReason: checked.verificationReason || (checked.officialVerified ? '' : 'official site discovered but not verified') });
  }
  return { leads, campaigns, pending, queries, provider: searchProvider.name, status: 'ok', companiesResolved: companyCache.size, resolutionCache };
}
