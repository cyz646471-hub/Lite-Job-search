import { isCompanySpecificAtsHost } from './cn-official-link-governance.mjs';

const JOB_BOARD_DOMAINS = [
  ['liepin.com', '猎聘'],
  ['zhipin.com', 'BOSS直聘'],
  ['bosszhipin.com', 'BOSS直聘'],
  ['zhaopin.com', '智联招聘'],
  ['51job.com', '前程无忧'],
  ['lagou.com', '拉勾'],
];
const DISCOVERY_ONLY_DOMAINS = [
  'nowcoder.com', 'gankinterview.cn', 'gankinterview.com', 'niuqizp.com',
  'yingjiesheng.com', 'shixiseng.com', 'wondercv.com', 'gaoxiaojob.com',
  'ncss.cn', '91wllm.cn', '91wllm.com',
];
const ATS_DOMAINS = [
  'mokahr.com', 'zhiye.com', 'hotjob.cn', 'jobs.feishu.cn', 'myworkdayjobs.com',
  'greenhouse.io', 'smartrecruiters.com', 'tupu360.com', 'moseeker.com',
  '73cn.cn', 'jobs.lever.co', 'jobs.ashbyhq.com',
];
const RECRUITMENT_SEMANTICS = /招聘|职位|岗位|校招|校园招聘|社会招聘|社招|实习|应届|人才招聘|加入我们|career|careers|jobs?|positions?|campus|graduate|intern|recruit|join us/i;
const CONTENT_SEMANTICS = /新闻|资讯|报道|媒体|百科|论坛|文章|行业动态|news|article|content|press|media|wiki|blog/i;
const PAID_SEMANTICS = /广告|推广|赞助|商业推广|推广链接|promoted|sponsored|\bad\b/i;
const CORPORATE_SUFFIX = /(?:集团|股份)?有限公司$|有限责任公司$|股份公司$|集团$/;

function parseUrl(value = '') {
  try {
    const url = new URL(String(value || '').trim());
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function normalizeCompany(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(CORPORATE_SUFFIX, '')
    .replace(/[\s\-—_·•（）()【】\[\]，,。.!！?？]/g, '');
}

function companyAliases(project = {}) {
  return [...new Set([
    project.company,
    project.companyName,
    project.canonicalName,
    ...(project.companyAliases || []),
    ...(project.brandNames || []),
  ].map(normalizeCompany).filter((value) => value.length >= 2))];
}

function companyIdentityMatch(candidate = {}, project = {}) {
  if (candidate.companyIdentityConfirmed === true || candidate.verifiedTenant === true) return true;
  const text = normalizeCompany(`${candidate.title || ''} ${candidate.snippet || ''} ${candidate.displayedCompany || ''}`);
  return companyAliases(project).some((alias) => text.includes(alias) || alias.includes(text));
}

function platformForHost(host = '') {
  return JOB_BOARD_DOMAINS.find(([domain]) => hostMatches(host, domain)) || null;
}

function isJobBoardCompanyPage(url, platformName) {
  const path = url.pathname.toLowerCase();
  if (platformName === '猎聘') return /^\/company-jobs\/\d+\/?$/.test(path) || /^\/company\/\d+\/?$/.test(path);
  if (platformName === 'BOSS直聘') return /^\/gongsi\/job\/[a-z0-9]+\.html$/.test(path) || /^\/companys?\/[a-z0-9]+\/?(?:jobs?)?\/?$/.test(path);
  if (platformName === '智联招聘') return /\/company\/.+\/jobs?\/?$/.test(path) || /\/companydetail\/.+/.test(path);
  if (platformName === '前程无忧') return /\/company\/.+/.test(path);
  if (platformName === '拉勾') return /\/gongsi\/j\d+\.html$/.test(path) || /\/gongsi\/\d+\.html$/.test(path);
  return false;
}

function isJobBoardSearchPage(url) {
  const path = url.pathname.toLowerCase();
  return /\/zhaopin\/?$|\/web\/geek\/job\/?$|\/jobs?\/search|\/search|\/sou\/|\/list\//.test(path)
    || [...url.searchParams.keys()].some((key) => /^(?:key|keyword|query|kw)$/i.test(key));
}

function provisionalOfficialRole(url) {
  const path = url.pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (/\/(?:apply|application)(?:\/|$)/.test(path)) return 'APPLY';
  if (/\/(?:job|position)\/[^/]+/.test(path) || /(?:jobId|positionId)=/i.test(url.search)) return 'JOB_DETAIL';
  if (/\/(?:jobs?|positions?|internship|graduate|social\/position)(?:\/|$)/.test(path)) return 'JOB_LIST';
  if (/\/(?:campus|recruit|career|careers|join)(?:\/|$)/.test(path) && path.split('/').filter(Boolean).length <= 2) return 'CAREER_HOME';
  return 'CAREER_HOME';
}

export function classifyRecruitmentSearchResult(candidate = {}, project = {}) {
  const url = parseUrl(candidate.url || candidate.normalizedUrl || candidate.finalUrl);
  const rejectionReasons = [];
  if (!url) {
    return { ...candidate, url: '', candidateKind: 'INVALID', decision: 'REJECT', rejectionReasons: ['invalid_url'], companyIdentityMatched: false };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const text = `${candidate.title || ''} ${candidate.snippet || ''}`;
  const companyIdentityMatched = companyIdentityMatch(candidate, project);
  const platform = platformForHost(host);

  if (candidate.isAd === true || candidate.ad === true || candidate.isPaid === true || PAID_SEMANTICS.test(`${candidate.badge || ''} ${candidate.resultType || ''}`)) {
    rejectionReasons.push('paid_search_result');
  }
  if (CONTENT_SEMANTICS.test(`${url.pathname} ${candidate.resultType || ''}`) || CONTENT_SEMANTICS.test(text) && !/招聘职位|岗位列表/.test(text)) {
    rejectionReasons.push('news_or_content_page');
  }
  if (DISCOVERY_ONLY_DOMAINS.some((domain) => hostMatches(host, domain))) rejectionReasons.push('discovery_source_only');
  if (rejectionReasons.length) {
    return { ...candidate, url: url.href, candidateKind: 'REJECTED_SOURCE', decision: 'REJECT', rejectionReasons, companyIdentityMatched };
  }

  if (platform) {
    const [, platformName] = platform;
    if (isJobBoardSearchPage(url)) {
      return { ...candidate, url: url.href, candidateKind: 'JOB_BOARD_SEARCH', decision: 'REJECT', rejectionReasons: ['job_board_search_page'], platformName, companyIdentityMatched };
    }
    if (!isJobBoardCompanyPage(url, platformName)) {
      return { ...candidate, url: url.href, candidateKind: 'JOB_BOARD_OTHER', decision: 'REJECT', rejectionReasons: ['job_board_not_company_list'], platformName, companyIdentityMatched };
    }
    if (!companyIdentityMatched) {
      return { ...candidate, url: url.href, candidateKind: 'JOB_BOARD_COMPANY_LIST', decision: 'REJECT', rejectionReasons: ['company_identity_mismatch'], platformName, companyIdentityMatched };
    }
    return {
      ...candidate,
      url: url.href,
      candidateKind: 'JOB_BOARD_COMPANY_LIST',
      provisionalRole: 'JOB_BOARD_COMPANY_LIST',
      decision: 'FALLBACK',
      rejectionReasons: [],
      platformName,
      platformCompanyName: candidate.displayedCompany || candidate.title || '',
      companyIdentityMatched,
      entrySourceTier: 'JOB_BOARD_FALLBACK',
    };
  }

  const recruitmentSemantics = RECRUITMENT_SEMANTICS.test(`${url.href} ${text}`);
  const officialDomain = String(project.officialDomain || project.careerDomain || '').toLowerCase().replace(/^www\./, '');
  const confirmedDomain = Boolean(officialDomain && hostMatches(host, officialDomain));
  const ats = ATS_DOMAINS.some((domain) => hostMatches(host, domain))
    && (candidate.verifiedTenant === true || isCompanySpecificAtsHost(url.href));
  if (!companyIdentityMatched) rejectionReasons.push('company_identity_mismatch');
  if (!recruitmentSemantics) rejectionReasons.push('missing_recruitment_semantics');
  if (rejectionReasons.length) {
    return {
      ...candidate,
      url: url.href,
      candidateKind: recruitmentSemantics ? 'UNKNOWN' : 'CORPORATE_MAIN',
      decision: 'REJECT',
      rejectionReasons,
      companyIdentityMatched,
    };
  }

  return {
    ...candidate,
    url: url.href,
    candidateKind: ats ? 'ATS_RECRUITMENT' : 'OFFICIAL_RECRUITMENT',
    provisionalRole: provisionalOfficialRole(url),
    decision: 'VERIFY_PAGE',
    rejectionReasons: [],
    companyIdentityMatched,
    confirmedDomain,
    platformName: '',
    entrySourceTier: ats ? 'ATS_CANDIDATE' : 'OFFICIAL_CANDIDATE',
  };
}

const CANDIDATE_PRIORITY = { OFFICIAL_RECRUITMENT: 3, ATS_RECRUITMENT: 2, JOB_BOARD_COMPANY_LIST: 1 };

export function selectBestRecruitmentEntry(candidates = []) {
  const usable = candidates
    .filter((candidate) => ['VERIFY_PAGE', 'FALLBACK'].includes(candidate.decision))
    .sort((a, b) => (CANDIDATE_PRIORITY[b.candidateKind] || 0) - (CANDIDATE_PRIORITY[a.candidateKind] || 0) || Number(a.rank || 999) - Number(b.rank || 999));
  const selected = usable[0] || null;
  const base = {
    companyCareerHomeUrl: '',
    campaignLandingUrl: '',
    jobListUrl: '',
    jobDetailUrl: '',
    applyUrl: '',
    officialCandidateUrl: '',
    platformJobListUrl: '',
    platformName: '',
    platformCompanyName: '',
    platformIdentityConfirmed: false,
    entrySourceTier: '',
    bestAvailableUrl: '',
    bestAvailableUrlLabel: '暂无可用链接',
    selectedCandidate: selected,
  };
  if (!selected) return base;
  if (selected.candidateKind === 'JOB_BOARD_COMPANY_LIST') {
    return {
      ...base,
      platformJobListUrl: selected.url,
      platformName: selected.platformName || '',
      platformCompanyName: selected.platformCompanyName || '',
      platformIdentityConfirmed: selected.companyIdentityMatched === true,
      entrySourceTier: 'JOB_BOARD_FALLBACK',
      bestAvailableUrl: selected.url,
      bestAvailableUrlLabel: '查看平台岗位',
    };
  }
  return {
    ...base,
    officialCandidateUrl: selected.url,
    entrySourceTier: selected.candidateKind === 'ATS_RECRUITMENT' ? 'ATS_CANDIDATE' : 'OFFICIAL_CANDIDATE',
    bestAvailableUrl: selected.url,
    bestAvailableUrlLabel: '验证招聘入口',
  };
}
