const STATUS_PRIORITY = Object.freeze({
  VERIFIED: 0,
  REVIEW: 1,
  BLOCKED: 2,
  CANDIDATE: 3,
  REJECTED: 4,
});

const PAGE_PRIORITY = Object.freeze({
  APPLY: 0,
  JOB_DETAIL: 1,
  JOB_LIST: 2,
  CAMPAIGN: 3,
  CAREER_HOME: 4,
  CORPORATE_HOME: 5,
  UNKNOWN: 6,
});

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function bestPortal(portals = []) {
  return [...portals].sort((left, right) => (
    (STATUS_PRIORITY[left.verificationStatus] ?? 9)
      - (STATUS_PRIORITY[right.verificationStatus] ?? 9)
    || (PAGE_PRIORITY[left.pageType] ?? 9) - (PAGE_PRIORITY[right.pageType] ?? 9)
    || Number(right.confidenceScore || 0) - Number(left.confidenceScore || 0)
    || timestamp(right.lastCheckedAt || right.lastVerifiedAt)
      - timestamp(left.lastCheckedAt || left.lastVerifiedAt)
  ))[0] || null;
}

export function buildCompanyCollectionRows({
  companies = [],
  portals = [],
  events = [],
  jobs = [],
} = {}) {
  const portalsByCompany = new Map();
  const eventsByCompany = new Map();
  const jobsByCompany = new Map();
  for (const portal of portals) {
    if (!portalsByCompany.has(portal.companyId)) portalsByCompany.set(portal.companyId, []);
    portalsByCompany.get(portal.companyId).push(portal);
  }
  for (const event of events) {
    if (!eventsByCompany.has(event.companyId)) eventsByCompany.set(event.companyId, []);
    eventsByCompany.get(event.companyId).push(event);
  }
  for (const job of jobs) {
    if (!jobsByCompany.has(job.companyId)) jobsByCompany.set(job.companyId, []);
    jobsByCompany.get(job.companyId).push(job);
  }

  return Object.freeze(companies.map((company) => {
    const companyPortals = portalsByCompany.get(company.id) || [];
    const companyEvents = eventsByCompany.get(company.id) || [];
    const companyJobs = jobsByCompany.get(company.id) || [];
    const portal = bestPortal(companyPortals);
    const openEvents = companyEvents.filter((event) => event.status === 'OPEN');
    const activeJobs = companyJobs.filter((job) => job.status === 'ACTIVE');
    return Object.freeze({
      公司名称: clean(company.canonicalName),
      中文名: clean(company.chineseName),
      英文名: clean(company.englishName),
      国家地区: clean(company.countryRegion),
      公司官网域名: (company.officialDomains || []).map(clean).filter(Boolean).join('、'),
      招聘入口: clean(portal?.canonicalUrl),
      招聘渠道: clean(portal?.channelType),
      来源等级: clean(portal?.sourceTier),
      页面类型: clean(portal?.pageType),
      核验状态: clean(portal?.verificationStatus) || '未发现',
      可信度: portal ? Number(portal.confidenceScore || 0) : null,
      招聘状态: clean(portal?.hiringAvailability) || 'UNKNOWN',
      已登记入口数: companyPortals.length,
      开放招聘批次数: openEvents.length,
      活跃岗位数: activeJobs.length,
      招聘类型: [...new Set(companyEvents.map((event) => clean(event.recruitmentType)).filter(Boolean))]
        .join('、'),
      最后检查时间: portal?.lastCheckedAt || portal?.lastVerifiedAt || '',
    });
  }).sort((left, right) => (
    left.核验状态.localeCompare(right.核验状态)
    || left.公司名称.localeCompare(right.公司名称, 'zh-CN')
  )));
}
