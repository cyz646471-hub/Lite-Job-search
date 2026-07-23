import { normalizeText } from './core.mjs';
import { buildPlatformSearches, normalizeSearchWindow } from './platform-leads.mjs';

const ROLE_EXPANSIONS = [
  [/\bios\b/i, [
    'iOS', 'Swift', 'SwiftUI', 'UIKit', 'Xcode', 'iPhone', 'Apple Platform',
    'Mobile Engineer', 'Mobile Developer', 'Mobile Software Engineer',
    'Mobile Application Developer', 'Native Mobile Engineer', 'Client Engineer',
  ]],
  [/data analyst|analytics analyst/i, ['Data Analyst', 'Analytics Analyst', 'Business Intelligence Analyst', 'BI Analyst']],
  [/backend|back-end/i, ['Backend Engineer', 'Back-end Engineer', 'Backend Developer', 'Server Engineer']],
  [/frontend|front-end/i, ['Frontend Engineer', 'Front-end Engineer', 'Frontend Developer', 'Web Engineer', 'UI Engineer']],
  [/product manager/i, ['Product Manager', 'Associate Product Manager', 'APM']],
  [/investment analyst/i, ['Investment Analyst', 'Equity Research Analyst', 'Financial Analyst']],
  [/sales|account executive/i, ['Account Executive', 'Business Development Representative', 'Sales Development Representative']],
  [/marketing/i, ['Marketing Associate', 'Marketing Analyst', 'Growth Marketing']],
  [/hardware/i, ['Hardware Engineer', 'Electrical Engineer', 'Embedded Systems Engineer']],
];

function unique(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalizeText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function expandRoleTitles(targetRoles = []) {
  const expanded = [...targetRoles];
  for (const role of targetRoles) {
    for (const [pattern, aliases] of ROLE_EXPANSIONS) if (pattern.test(role)) expanded.push(...aliases);
  }
  return unique(expanded);
}

const CN_NEGATIVE_TITLES = ['Senior', 'Sr', 'Sr.', 'Staff', 'Principal', 'Lead', 'Manager', 'Director', 'Architect', 'Head of', 'Vice President'];

const REGION_QUERY_SOURCES = {
  NA: [
    { source: 'official-ats', query: '(site:job-boards.greenhouse.io OR site:jobs.lever.co OR site:jobs.ashbyhq.com OR site:myworkdayjobs.com OR site:jobs.smartrecruiters.com OR site:teamtailor.com) PLACEHOLDER_BODY' },
    { source: 'linkedin-lead', query: 'site:linkedin.com/jobs/view PLACEHOLDER_BODY' },
    { source: 'indeed-lead', query: 'site:indeed.com/viewjob PLACEHOLDER_BODY' },
    { source: 'official-careers-fallback', query: 'site:greenhouse.io OR site:lever.co OR site:ashbyhq.com PLACEHOLDER_BODY' },
  ],
  CN: [
    { source: 'zhipin-official', query: '(site:zhipin.com OR site:boss.zhipin.com) PLACEHOLDER_BODY' },
    { source: 'nowcoder-official', query: '(site:nowcoder.com OR site:nowcoder.cn) PLACEHOLDER_BODY' },
    { source: 'yingjiesheng-official', query: 'site:yingjiesheng.com PLACEHOLDER_BODY' },
    { source: 'tencent-official', query: '(site:careers.tencent.com OR site:join.qq.com) PLACEHOLDER_BODY' },
    { source: 'company-careers-cn', query: '(site:hr.bytedance.com OR site:jobs.bytedance.com OR site:campus.alibaba.com OR site:talent.baidu.com OR site:jd.com/join OR site:careers.meituan.com OR site:pinduoduo.com/jobs) PLACEHOLDER_BODY' },
    { source: 'lagou-liepin', query: '(site:lagou.com OR site:liepin.com) PLACEHOLDER_BODY' },
  ],
};

function regionSources(region) {
  return REGION_QUERY_SOURCES[region] || REGION_QUERY_SOURCES.NA;
}

export function createSearchPlan(student, { maxPostingAgeDays = 90, region = 'NA' } = {}) {
  const windowDays = normalizeSearchWindow(maxPostingAgeDays);
  const marketRegion = region === 'CN' ? 'CN' : 'NA';
  const earlyCareer = student.maxExperienceYears === null || student.maxExperienceYears <= 1;
  let roles = expandRoleTitles(student.targetRoles);
  if (earlyCareer) {
    const earlyAdditions = marketRegion === 'CN'
      ? ['软件工程师', '初级软件工程师', '应届', '校招', '助理工程师', '前端工程师', '后端工程师', '移动端工程师']
      : ['Software Engineer I', 'Junior Software Engineer', 'New Grad Software Engineer', 'Entry Level Software Engineer', 'Associate Software Engineer', 'Frontend Engineer I', 'Junior Frontend Engineer', 'Backend Engineer I', 'Junior Backend Engineer', 'Mobile Engineer I', 'Junior Mobile Engineer'];
    roles = unique([...roles, ...earlyAdditions]);
  }
  const locations = unique(student.locations);
  const negativeTitles = earlyCareer
    ? (marketRegion === 'CN' ? CN_NEGATIVE_TITLES : ['Senior', 'Sr', 'Sr.', 'Staff', 'Principal', 'Lead', 'Manager', 'Director', 'Architect', 'Head of', 'Vice President', 'Engineer II', 'Engineer III', 'Engineer IV', 'Android'])
    : [];
  const roleLimit = marketRegion === 'CN' ? 18 : 8;
  const locationLimit = marketRegion === 'CN' ? 6 : 8;
  const quote = '“';
  const endQ = '”';
  const quotedRoles = roles.slice(0, roleLimit).map((role) => quote + role + endQ).join(' OR ');
  const quotedLocations = locations.slice(0, locationLimit).map((loc) => quote + loc + endQ).join(' OR ');
  const stageTerms = marketRegion === 'CN'
    ? '(应届 OR 校招 OR 初级 OR 助理 OR new grad OR entry level)'
    : '("new grad" OR "entry level" OR junior OR associate OR internship)';
  const queryBody = ('(' + quotedRoles + ') ' + stageTerms + ' (' + quotedLocations + ')').replace(/\s+/g, ' ').trim();
  const sourceTemplates = regionSources(marketRegion);
  const discoveryQueries = sourceTemplates.map((template) => ({ source: template.source, query: template.query.replace('PLACEHOLDER_BODY', queryBody) }));
  const platformSearches = marketRegion === 'CN' ? [] : buildPlatformSearches({ roles, locations, sinceDays: windowDays });
  return {
    studentId: student.studentId,
    studentName: student.studentName,
    marketRegion,
    roles,
    locations,
    maxExperienceYears: student.maxExperienceYears,
    allowedJobTypes: student.allowedJobTypes,
    scanConfig: {
      marketRegion,
      max_posting_age_days: windowDays,
      title_filter: { positive: roles, negative: negativeTitles },
      content_filter: {
        by_title_keyword: Object.fromEntries(
          roles.filter((role) => /mobile|client engineer/i.test(role))
            .map((role) => [role, { positive: marketRegion === 'CN' ? ['ios', 'swift', '移动'] : ['ios', 'swift', 'swiftui', 'uikit', 'xcode', 'iphone', 'apple platform'], negative: ['android only'] }]),
        ),
      },
      location_filter: { always_allow: locations.filter((value) => /remote|远程/i.test(value)), allow: locations, block: [] },
      region_extension: marketRegion === 'CN' ? { cn_sources: ['nowcoder', 'yingjiesheng', 'tencent', 'lagou'], platform_leads_require_browser_metadata: true, platform_leads_require_official_promotion: false } : {},
    },
    discoveryQueries,
    platformSearches,
    retrievalPolicy: {
      marketRegion,
      target: 50,
      candidateBuffer: 3,
      candidateTarget: 150,
      categoryTargets: marketRegion === 'CN' ? { cn_campus: 30, cn_social: 10, frontend: 5, backend: 5 } : { mobile_ios: 30, frontend: 10, backend: 10 },
      windowDays,
      platformLeadsRequireBrowserMetadata: true,
      platformLeadsRequireOfficialPromotionOrVerifiedApply: marketRegion !== 'CN',
      linkedInNativeDateLimitDays: 30,
      indeedNativeDateLimitDays: 14,
    },
  };
}
