import { createHash } from 'node:crypto';
import { classifyRecruitmentUrl, isOfficialApplyChannel } from './official-links.mjs';
import { resolveCompanyName } from './cn-company-resolver.mjs';

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
export function canonicalCnCompany(value = '') { return resolveCompanyName(value).companyId; }

export function inferRecruitmentBatch(record = {}) {
  const text = `${record.batchName || ''} ${record.title || ''} ${record.description || record.snippet || ''}`;
  if (/提前批|提前招聘|early\s*program/i.test(text)) return '提前批';
  if (/补录|补招|补充招聘/i.test(text)) return '补录';
  if (/暑期.*实习|summer\s+intern/i.test(text)) return '暑期实习';
  if (/日常实习|长期实习|实习生|intern/i.test(text)) return '日常实习';
  if (/秋招|秋季(?:校园)?招聘|秋季招聘/i.test(text)) return '秋招';
  if (/春招|春季(?:校园)?招聘|春季招聘/i.test(text)) return '春招';
  if (/社招|社会招聘|经验招聘/i.test(text)) return '社招';
  if (/校招|校园招聘|应届|(?:20)?2\d届/i.test(text)) return '校招';
  return record.scope === 'internship' ? '日常实习' : record.scope === 'social' ? '社招' : '待确认批次';
}

export function recruitmentProjectKey(record = {}) {
  const cohort = Number(record.cohortYear) || (record.scope === 'internship' ? 'daily' : 'unknown');
  const campaignYear = Number(record.campaignYear) || new Date(Number(record.campaignStartAt || record.postedAt || record.firstSeenAt || Date.now())).getUTCFullYear();
  const raw = `${canonicalCnCompany(record.company)}|${cohort}|${inferRecruitmentBatch(record)}|${campaignYear}`;
  return createHash('sha1').update(raw).digest('hex').slice(0, 24);
}

export function sourceTrust(sourceType = '', url = '') {
  const channel = classifyRecruitmentUrl(url).channel;
  if (sourceType === 'official_company' || sourceType === 'official_ats' || channel === 'official_careers' || channel === 'delegated_official') return { tier: 'official', label: '企业官方招聘官网', score: 100 };
  if (channel === 'official_wechat' || sourceType === 'official_announcement') return { tier: 'high', label: '企业官方公众号/公告', score: 90 };
  if (sourceType === 'government' || sourceType === 'university') return { tier: 'high', label: '政府/高校就业官网', score: 85 };
  if (sourceType === 'aggregator' || sourceType === 'discovery_index' || sourceType === 'job_board') return { tier: 'discovery', label: '招聘聚合发现源', score: 45 };
  return { tier: 'lead', label: '待核验线索源', score: 20 };
}

export function detectAts(value = '') {
  let host = '';
  try { host = new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
  const vendors = [
    [/lever\.co$/, 'Lever'], [/greenhouse\.io$/, 'Greenhouse'], [/ashbyhq\.com$/, 'Ashby'],
    [/myworkdayjobs\.com$/, 'Workday'], [/smartrecruiters\.com$/, 'SmartRecruiters'],
    [/teamtailor\.com$/, 'Teamtailor'], [/workable\.com$/, 'Workable'], [/bamboohr\.com$/, 'BambooHR'],
    [/successfactors\.com$/, 'SAP SuccessFactors'], [/recruitee\.com$/, 'Recruitee'], [/avature\.net$/, 'Avature'],
  ];
  return vendors.find(([pattern]) => pattern.test(host))?.[1] || '';
}

function validRedirectTarget(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || /^(?:0|10|127)\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host) || host === '::1') return false;
    return true;
  } catch { return false; }
}

export async function resolveFinalRecruitmentUrl(value, { fetcher = fetch, maxRedirects = 5, timeoutMs = 10_000 } = {}) {
  let url = clean(value);
  const chain = [];
  for (let step = 0; step <= maxRedirects; step++) {
    if (!validRedirectTarget(url)) return { url: '', chain, status: 'blocked_invalid_target', ats: '' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (compatible; Career-OP/1.19; +https://github.com/cyz646471-hub/career-ops)' }, signal: controller.signal });
      const location = response.headers?.get?.('location');
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, url).href;
        chain.push(next);
        url = next;
        continue;
      }
      const rawContent = response.ok && typeof response.clone === 'function'
        ? await response.clone().text().then((text) => text.slice(0, 2_000_000)).catch(() => '') : '';
      return { url: response.url || url, chain, status: response.ok ? 'resolved' : `http_${response.status}`, ats: detectAts(response.url || url), response, rawContent };
    } catch (error) {
      return { url, chain, status: error?.name === 'AbortError' ? 'timeout' : 'request_error', ats: detectAts(url), error: error?.message || String(error) };
    } finally { clearTimeout(timer); }
  }
  return { url, chain, status: 'too_many_redirects', ats: detectAts(url) };
}

export async function verifyOfficialRecruitmentProject(record = {}, { fetcher = fetch, now = Date.now(), archiveDocument = null } = {}) {
  const candidate = record.officialUrl || record.applyUrl || record.url || '';
  const classified = classifyRecruitmentUrl(candidate);
  if (!candidate || !isOfficialApplyChannel(classified.channel)) return { ...record, officialVerified: false, verificationStatus: 'pending_official_source', verificationReason: '尚未取得企业官网、官方公众号或受委托ATS入口', verificationCheckedAt: now };
  const resolved = await resolveFinalRecruitmentUrl(classified.url, { fetcher });
  const finalClassified = classifyRecruitmentUrl(resolved.url);
  if (typeof archiveDocument === 'function' && resolved.url) {
    await archiveDocument({ url: resolved.url, sourceType: finalClassified?.channel === 'official_wechat' ? 'wechat' : 'official_site', sourceName: record.company, title: record.title || record.batchName, rawContent: resolved.rawContent || '', plainText: '', httpStatus: Number(resolved.response?.status) || null, contentType: resolved.response?.headers?.get?.('content-type') || 'html', parentDocumentId: record.documentId || null }, { now }).catch(() => {});
  }
  const reachable = resolved.status === 'resolved';
  const officialChannel = isOfficialApplyChannel(finalClassified.channel) || Boolean(resolved.ats);
  const pageText = clean(resolved.rawContent).toLowerCase();
  const companyTokens = [record.company, resolveCompanyName(record.company).canonicalName].map((x) => clean(x).toLowerCase()).filter((x) => x.length >= 2);
  const urlText = `${resolved.url || ''}`.toLowerCase();
  const officialIdentityConfirmed = Boolean(reachable && officialChannel && (record.sourceType === 'official_company' || companyTokens.some((token) => pageText.includes(token) || urlText.includes(token.replace(/[^a-z0-9\u3400-\u9fff]/g, '')))));
  const cohort = Number(record.cohortYear);
  const type = inferRecruitmentBatch(record);
  const yearMatch = !cohort || pageText.includes(String(cohort));
  const typeMatch = !type || type === '待确认批次' || pageText.includes(type) || (type === '校招' && /校园招聘|校招|应届/.test(pageText));
  const campaignConfirmed = Boolean(officialIdentityConfirmed && yearMatch && typeMatch && /招聘|校招|实习|秋招|春招|提前批|补录|职位|岗位|career|jobs|join/i.test(pageText || urlText));
  const closedSignal = /已结束|已截止|停止招聘|全部关闭|no longer accepting|position closed/i.test(pageText) || ['http_404','http_410'].includes(resolved.status);
  const hasApplyAction = /立即投递|申请职位|投递简历|岗位列表|职位列表|apply now|view jobs|open positions/i.test(pageText) || Boolean(resolved.ats);
  const applicationActive = !reachable ? null : closedSignal ? false : hasApplyAction ? true : null;
  const verificationState = officialIdentityConfirmed && campaignConfirmed ? (applicationActive === false ? 'EXPIRED' : 'VERIFIED') : officialChannel && reachable ? 'PARTIALLY_VERIFIED' : 'UNVERIFIED';
  const verified = officialIdentityConfirmed && campaignConfirmed;
  return {
    ...record,
    officialUrl: resolved.url || classified.url,
    applyUrl: resolved.url || classified.url,
    finalApplyUrl: resolved.url || classified.url,
    redirectChain: resolved.chain,
    ats: resolved.ats || detectAts(resolved.url),
    reachable, officialCandidateFound: Boolean(candidate), officialIdentityConfirmed, campaignConfirmed, applicationActive, hasApplyAction, closedSignal,
    officialVerified: verified,
    verificationStatus: verified ? (applicationActive === true ? 'active_verified' : applicationActive === false ? 'expired' : 'verified') : officialChannel && reachable ? 'partially_verified' : 'unverified', verificationState,
    verificationReason: verified ? '官方主体与招聘批次均已确认' : reachable ? '链接可访问，但官方主体或招聘批次尚未同时确认' : `官网入口核验：${resolved.status}`,
    verificationCheckedAt: now,
    lastVerifiedAt: verified ? now : record.lastVerifiedAt,
    livenessStatus: applicationActive === true ? 'active' : applicationActive === false ? 'closed' : record.livenessStatus || 'unverified',
  };
}

function unique(values) { return [...new Set(values.map(clean).filter(Boolean))]; }
function bestLink(records) {
  if (records.some((record) => record.recruitmentLinks)) return records.map((record) => record.recruitmentLinks?.applyUrl).find(Boolean) || '';
  const links = records.flatMap((record) => [record.finalApplyUrl, record.applyUrl, record.officialUrl, record.primaryUrl, ...(record.sourceLinks || []).filter((link) => link.linkType === 'apply').map((link) => link.url)].filter(Boolean).map((url) => ({ url, record })))
    .filter((item) => item.record.officialIdentityConfirmed === true && isOfficialApplyChannel(classifyRecruitmentUrl(item.url).channel));
  links.sort((a, b) => sourceTrust(b.record.sourceType, b.url).score - sourceTrust(a.record.sourceType, a.url).score);
  return links[0]?.url || '';
}

function bestDetailLink(records, fallback = '') {
  if (records.some((record) => record.recruitmentLinks)) return records.map((record) => record.recruitmentLinks?.campaignAnnouncementUrl).find(Boolean) || fallback;
  const links = records.flatMap((record) => [record.announcementUrl, record.detailUrl, ...(record.sourceLinks || []).filter((link) => link.linkType === 'detail').map((link) => link.url)].filter(Boolean).map((url) => ({ url, record })))
    .filter((item) => item.record.officialIdentityConfirmed === true && isOfficialApplyChannel(classifyRecruitmentUrl(item.url).channel));
  links.sort((a, b) => sourceTrust(b.record.sourceType, b.url).score - sourceTrust(a.record.sourceType, a.url).score);
  return links[0]?.url || fallback;
}

export function aggregateCnRecruitmentProjects(records = []) {
  const groups = new Map();
  for (const record of records) {
    if (!clean(record.company)) continue;
    const key = record.projectId || recruitmentProjectKey(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return [...groups.entries()].map(([projectId, group]) => {
    const representative = [...group].sort((a, b) => Number(b.lastVerifiedAt || b.postedAt || 0) - Number(a.lastVerifiedAt || a.postedAt || 0))[0];
    const officialVerified = group.some((item) => item.officialVerified === true && item.officialIdentityConfirmed === true && item.campaignConfirmed === true);
    const jobs = unique(group.filter((item) => item.recordType !== 'recruitment_campaign' && item.recordType !== 'index_lead').map((item) => item.title));
    const batch = inferRecruitmentBatch(representative);
    const sources = unique(group.flatMap((item) => item.sources || [item.source]));
    const sourceLinks = [...new Map(group.flatMap((item) => item.sourceLinks || []).filter((item) => item?.url).map((item) => [item.url, item])).values()];
    const primaryUrl = bestLink(group);
    const applyUrl = group.map((item) => item.resolvedLinks?.applyUrl || item.recruitmentLinks?.applyUrl).find(Boolean) || '';
    const rawJobDetailUrl = group.map((item) => item.resolvedLinks?.jobDetailUrl || item.recruitmentLinks?.jobDetailUrl).find(Boolean) || '';
    const jobDetailUrl = rawJobDetailUrl === applyUrl ? '' : rawJobDetailUrl;
    const rawJobListUrl = group.map((item) => item.resolvedLinks?.jobListUrl || item.recruitmentLinks?.jobListUrl).find(Boolean) || '';
    const jobListUrl = [applyUrl, jobDetailUrl].includes(rawJobListUrl) ? '' : rawJobListUrl;
    const rawCampaignLandingUrl = group.map((item) => item.resolvedLinks?.campaignLandingUrl || item.recruitmentLinks?.campaignLandingUrl || item.recruitmentLinks?.campaignAnnouncementUrl).find(Boolean) || '';
    const campaignLandingUrl = [applyUrl, jobDetailUrl, jobListUrl].includes(rawCampaignLandingUrl) ? '' : rawCampaignLandingUrl;
    const rawCompanyCareerHomeUrl = group.map((item) => item.resolvedLinks?.companyCareerHomeUrl || item.recruitmentLinks?.companyCareerHomeUrl).find(Boolean) || '';
    const companyCareerHomeUrl = [applyUrl, jobDetailUrl, jobListUrl, campaignLandingUrl].includes(rawCompanyCareerHomeUrl) ? '' : rawCompanyCareerHomeUrl;
    const officialApplyUrl = applyUrl || jobDetailUrl || jobListUrl;
    // Keep link roles distinct: a job list or career home is a valid frontend
    // fallback, but it is not automatically a campaign/job detail page.
    const officialDetailUrl = jobDetailUrl || campaignLandingUrl || companyCareerHomeUrl || bestDetailLink(group, '');
    const entryRole = applyUrl ? 'DIRECT_APPLICATION' : jobDetailUrl ? 'JOB_DETAIL' : jobListUrl ? 'JOB_LIST' : campaignLandingUrl ? 'CAMPAIGN_LANDING' : companyCareerHomeUrl ? 'CAREER_HOME' : '';
    const platformJobListUrl = group.map((item) => item.resolvedLinks?.platformJobListUrl || item.recruitmentLinks?.platformJobListUrl || item.platformJobListUrl).find(Boolean) || '';
    const platformSource = group.find((item) => (item.resolvedLinks?.platformJobListUrl || item.recruitmentLinks?.platformJobListUrl || item.platformJobListUrl) === platformJobListUrl);
    const platformName = platformSource?.resolvedLinks?.platformName || platformSource?.recruitmentLinks?.platformName || platformSource?.platformName || '';
    const platformCompanyName = platformSource?.resolvedLinks?.platformCompanyName || platformSource?.recruitmentLinks?.platformCompanyName || platformSource?.platformCompanyName || '';
    const platformIdentityConfirmed = Boolean(platformJobListUrl && (platformSource?.resolvedLinks?.platformIdentityConfirmed === true || platformSource?.recruitmentLinks?.platformIdentityConfirmed === true || platformSource?.platformIdentityConfirmed === true));
    const entrySourceTier = group.map((item) => item.resolvedLinks?.entrySourceTier || item.recruitmentLinks?.entrySourceTier || item.entrySourceTier).find(Boolean) || (platformIdentityConfirmed ? 'JOB_BOARD_FALLBACK' : '');
    const bestAvailableUrl = group.map((item) => item.resolvedLinks?.bestAvailableUrl || item.recruitmentLinks?.bestAvailableUrl).find(Boolean) || '';
    const bestAvailableUrlLabel = group.find((item) => (item.resolvedLinks?.bestAvailableUrl || item.recruitmentLinks?.bestAvailableUrl) === bestAvailableUrl)?.resolvedLinks?.bestAvailableUrlLabel || group.find((item) => item.recruitmentLinks?.bestAvailableUrl === bestAvailableUrl)?.recruitmentLinks?.bestAvailableUrlLabel || '暂无可用链接';
    const candidateOfficialUrl = group.map((item) => item.resolvedLinks?.candidateOfficialUrl || item.recruitmentLinks?.candidateOfficialUrl).find(Boolean) || '';
    const candidateApplyUrl = group.map((item) => item.resolvedLinks?.candidateApplyUrl || item.recruitmentLinks?.candidateApplyUrl).find(Boolean) || '';
    return {
      ...representative,
      id: projectId, projectId, recordType: 'recruitment_project', companyStandardId: canonicalCnCompany(representative.company), campaignYear: Number(representative.campaignYear) || new Date(Number(representative.campaignStartAt || representative.postedAt || representative.firstSeenAt || Date.now())).getUTCFullYear(),
      projectName: `${representative.company}${representative.cohortYear ? `${representative.cohortYear}届` : ''}${batch}`,
      recruitmentType: batch, title: jobs.length ? jobs.join(' / ') : (representative.batchName || `${representative.company}招聘`),
      jobTitles: jobs, location: unique(group.map((item) => item.location)).join(' / '),
      roleCategories: unique(group.flatMap((item) => item.roleCategories || []).concat(group.map((item) => item.roleFamily))).filter(Boolean),
      postedAt: Math.min(...group.map((item) => Number(item.postedAt || item.firstSeenAt || Date.now()))),
      expiresAt: Math.max(...group.map((item) => Number(item.expiresAt || 0))) || null,
      firstSeenAt: Math.min(...group.map((item) => Number(item.firstSeenAt || Date.now()))),
      newInRun: group.some((item) => item.newInRun === true),
      sources, sourceLinks, primaryUrl, companyCareerHomeUrl, campaignLandingUrl, jobListUrl, jobDetailUrl, applyUrl, officialApplyUrl, officialDetailUrl, entryRole, officialUrl: officialApplyUrl, platformJobListUrl, platformName, platformCompanyName, platformIdentityConfirmed, entrySourceTier, candidateOfficialUrl, candidateApplyUrl, bestAvailableUrl, bestAvailableUrlLabel, officialVerified,
      verificationStatus: officialVerified ? 'verified' : (representative.verificationStatus || 'discovered'), verificationState: officialVerified ? 'VERIFIED' : (representative.verificationState || 'UNVERIFIED'),
      verificationCheckedAt: Math.max(...group.map((item) => Number(item.verificationCheckedAt || item.lastVerifiedAt || 0))) || null,
      reachable: group.some((item) => item.reachable), officialCandidateFound: group.some((item) => item.officialCandidateFound), officialIdentityConfirmed: group.some((item) => item.officialIdentityConfirmed), campaignConfirmed: group.some((item) => item.campaignConfirmed), applicationActive: group.some((item) => item.applicationActive === true) ? true : group.some((item) => item.applicationActive === false) ? false : null,
      ats: unique(group.map((item) => item.ats)).join(' / '),
      currentStatus: officialVerified ? (group.some((item) => item.livenessStatus === 'active') ? '开放中' : '已核验') : '待官网验证',
      confidence: officialVerified ? '高' : '线索',
      jobDetails: group.filter((item) => item.recordType !== 'recruitment_campaign' && item.recordType !== 'index_lead').map((item) => ({ title: item.title, location: item.location, url: bestLink([item]), status: item.livenessStatus || 'unverified' })),
    };
  }).sort((a, b) => Number(b.postedAt || b.firstSeenAt || 0) - Number(a.postedAt || a.firstSeenAt || 0));
}
