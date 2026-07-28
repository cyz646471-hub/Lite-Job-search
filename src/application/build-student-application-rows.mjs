const EVENT_LABELS = Object.freeze({
  CAMPUS_FULL_TIME: '校园招聘',
  CAMPUS_INTERNSHIP: '校园实习',
  DAILY_INTERNSHIP: '日常实习',
  EXPERIENCED: '社会招聘',
  SPECIAL_PROGRAM: '专项招聘',
});

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function eventLabel(event = {}) {
  const base = event.recruitmentType === 'SPECIAL_PROGRAM'
    ? clean(event.campaignName) || EVENT_LABELS.SPECIAL_PROGRAM
    : EVENT_LABELS[event.recruitmentType] || clean(event.recruitmentType);
  return event.cohort ? `${clean(event.cohort)} 届${base}` : base;
}

function sourcePriority(sourceTier) {
  if (sourceTier === 'OFFICIAL_SITE') return 0;
  if (sourceTier === 'OFFICIAL_ATS') return 1;
  if (sourceTier === 'OFFICIAL_SOCIAL') return 2;
  return 3;
}

export function buildStudentApplicationRows({
  companies = [],
  portals = [],
  events = [],
  jobs = [],
} = {}) {
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const portalById = new Map(portals.map((portal) => [portal.id, portal]));
  const jobsByEventId = new Map();
  for (const job of jobs) {
    if (!job.recruitmentEventId || job.status !== 'ACTIVE') continue;
    if (job.qualityGrade !== 'A' || job.publicationStatus !== 'PUBLISHED') continue;
    if (!['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(job.sourceTier)) continue;
    if (!jobsByEventId.has(job.recruitmentEventId)) jobsByEventId.set(job.recruitmentEventId, []);
    jobsByEventId.get(job.recruitmentEventId).push(job);
  }

  const rows = [];
  for (const event of events) {
    const company = companyById.get(event.companyId);
    const portal = portalById.get(event.careerPortalId);
    if (!company || !portal) continue;
    if (!['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(event.sourceTier)) continue;
    if (!['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(portal.sourceTier)) continue;
    if (portal.verificationStatus !== 'VERIFIED'
      || portal.officialIdentityConfirmed !== true) continue;
    if (event.status !== 'OPEN') continue;
    const eventJobs = jobsByEventId.get(event.id) || [];
    if (eventJobs.length === 0) continue;
    const titles = unique(eventJobs.map((job) => job.title)).sort();
    const locations = unique([
      ...(event.locations || []),
      ...eventJobs.flatMap((job) => job.locations || []),
    ]);
    rows.push(Object.freeze({
      公司名称: clean(company.canonicalName),
      公司类型: unique(company.industryTags || []).join('、'),
      公司简介: clean(company.description || company.summary),
      来源等级: clean(event.sourceTier),
      招聘批次: eventLabel(event),
      届次: clean(event.cohort),
      开始时间: event.startAt || '',
      截止时间: event.closesAt || '',
      地区: locations.join('、'),
      开放岗位: titles.join('；'),
      投递链接: event.directoryUrl
        || eventJobs.find((job) => job.applyUrl)?.applyUrl
        || eventJobs.find((job) => job.jobDetailUrl)?.jobDetailUrl
        || '',
      招聘状态: clean(event.status),
      最后核验时间: event.lastVerifiedAt || portal.lastVerifiedAt || '',
    }));
  }

  return Object.freeze(rows.sort((left, right) => (
    sourcePriority(left.来源等级) - sourcePriority(right.来源等级)
      || left.公司名称.localeCompare(right.公司名称, 'zh-CN')
      || left.届次.localeCompare(right.届次)
      || left.招聘批次.localeCompare(right.招聘批次, 'zh-CN')
  )));
}
