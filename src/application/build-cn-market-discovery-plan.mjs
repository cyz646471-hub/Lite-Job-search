import { selectUnseenCompanies } from './resolve-task-companies.mjs';

const PRIVATE_COHORTS = Object.freeze([
  ['AI与大模型', '人工智能', '大模型', 'AIGC'],
  ['互联网与消费科技', '互联网', '电商', '本地生活'],
  ['智能硬件与3C', '智能硬件', '消费电子', '3C'],
  ['智能汽车与机器人', '智能汽车', '机器人', '自动驾驶'],
  ['半导体与云软件', '半导体', '云计算', '企业软件'],
]);
const FOREIGN_COHORTS = Object.freeze([
  ['外资科技与工业', '外企', '中国', '招聘'],
  ['外资医疗与消费', '外企', '中国', '招聘'],
]);
const PUBLIC_COHORTS = Object.freeze([
  ['央国企与事业单位', '国企', '校园招聘'],
  ['科研与公共机构', '事业单位', '招聘'],
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function safeCount(value, fallback = 50) {
  const count = Number(value);
  return Number.isInteger(count) ? Math.max(1, Math.min(1_000, count)) : fallback;
}

function roleTerms(role) {
  const normalized = clean(role);
  return normalized ? [normalized, '招聘'] : ['招聘'];
}

function makeQueries(cohorts, tier, role, industry) {
  const terms = roleTerms(role);
  const sector = clean(industry);
  return cohorts.map(([name, ...keywords]) => Object.freeze({
    id: `CN_${tier}_${name}`,
    priorityTier: tier,
    cohort: name,
    query: ['中国', ...terms, sector, ...keywords, '招聘官网', '-新闻'].filter(Boolean).join(' '),
  }));
}

export function buildCnMarketDiscoveryPlan({
  role = '',
  industry = '',
  targetCount = 50,
  knownCompanies = [],
  discoveredCandidates = [],
  now = new Date().toISOString(),
} = {}) {
  const target = safeCount(targetCount);
  const queries = [
    ...makeQueries(PRIVATE_COHORTS, 1, role, industry),
    ...makeQueries(FOREIGN_COHORTS, 2, role, industry),
    ...makeQueries(PUBLIC_COHORTS, 3, role, industry),
  ];
  const selection = selectUnseenCompanies({
    registryCompanies: [],
    knownCompanies,
    supplementCompanies: discoveredCandidates,
    supplementConfigured: true,
    targetCount: target,
    market: 'CN',
  });
  return Object.freeze({
    mode: 'CN_MARKET_COMPANY_DISCOVERY',
    generatedAt: now,
    role: clean(role),
    industry: clean(industry),
    targetCount: target,
    llmUsage: Object.freeze({ enabled: false, reason: 'deterministic_queries_and_rules_only' }),
    queryPolicy: Object.freeze({ searchEngine: 'google', locale: 'zh-CN', automaticEngineFallback: false, blockedHandling: 'CHECKPOINT_BLOCKED' }),
    queries: Object.freeze(queries),
    queue: selection.companies,
    dedupe: selection.stats,
  });
}

const EXCLUDED_TEXT = /高校就业|就业网|新闻|资讯|培训|课程|广告|推广/i;
const THIRD_PARTY_SOURCE = /职友集|jobui|前程无忧|51job|智联招聘|boss直聘|猎聘|牛客|应届生/i;
const RECRUITING_TEXT = /招聘官网|校园招聘|社会招聘|实习招聘|加入我们|人才招聘|招聘职位|招聘/i;

function normalizedName(value) {
  return clean(value).normalize('NFKC').toLocaleLowerCase('en-US')
    .replace(/[\s()（）【】\[\],，.·'"_-]+/g, '');
}

function titleCompanyName(title) {
  const value = clean(title).replace(/[|｜_-].*$/, '').trim();
  const match = value.match(/^(.{2,40}?)(?:20\d{2}(?:届)?|校园招聘|社会招聘|实习招聘|招聘官网|人才招聘|招聘职位|加入我们|招聘)/);
  return clean(match?.[1] || '').replace(/[：: ]+$/, '');
}

export function extractCnMarketCompanyLeads(rows = [], { query = {}, seenNames = new Set() } = {}) {
  const selected = [];
  const rejected = [];
  const localSeen = new Set([...seenNames].map(normalizedName));
  for (const row of rows) {
    const title = clean(row?.title);
    const snippet = clean(row?.snippet);
    const url = clean(row?.href || row?.url);
    const text = `${title} ${snippet}`;
    const company = titleCompanyName(title);
    const nameKey = normalizedName(company);
    if (row?.kind !== 'organic' || !url || EXCLUDED_TEXT.test(`${text} ${url}`) || !RECRUITING_TEXT.test(text) || company.length < 2 || nameKey.length < 2) {
      rejected.push({ title, url, reasonCode: 'LOW_PRECISION_OR_EXCLUDED_SEARCH_RESULT' });
      continue;
    }
    if (localSeen.has(nameKey)) {
      rejected.push({ title, url, reasonCode: 'DUPLICATE_COMPANY_LEAD' });
      continue;
    }
    localSeen.add(nameKey);
    selected.push(Object.freeze({
      id: `market-cn-${nameKey.slice(0, 48)}`,
      company,
      chineseName: company,
      market: 'CN',
      industry: query.cohort ? [query.cohort] : [],
      discoverySource: 'visible_public_search',
      discoveryQuery: query.query || null,
      discoveryEvidenceUrl: url,
      discoveryEvidenceTitle: title,
      discoveryEvidenceClass: THIRD_PARTY_SOURCE.test(`${text} ${url}`)
        ? 'THIRD_PARTY_COMPANY_LEAD'
        : 'PUBLIC_SEARCH_COMPANY_LEAD',
      recruitmentEntryEligible: false,
      priorityTier: query.priorityTier || 3,
      fixedPool: false,
    }));
  }
  return Object.freeze({ leads: Object.freeze(selected), rejected: Object.freeze(rejected) });
}
