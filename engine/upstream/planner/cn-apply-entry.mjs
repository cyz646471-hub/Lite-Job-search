import { classifyGovernedRecruitmentUrl, isStaticAsset } from './cn-official-link-governance.mjs';
import { createHash } from 'node:crypto';
import { politeFetch } from './detail-fetchers.mjs';
import { isPublicFetchTarget } from './cn-url-evidence.mjs';

const APPLY_TEXT = /立即投递|立即申请|申请职位|提交简历|网申入口|apply(?:\s+now)?/i;
const JOB_TEXT = /查看职位|职位详情|职位列表|招聘岗位|search jobs|view jobs|open positions/i;
const CLOSED_TEXT = /已结束|已截止|停止申请|岗位已下线|停止招聘|position closed|no longer accepting/i;
const ACCESS_RESTRICTED_TEXT = /验证码|请登录|登录后|访问受限|安全验证|captcha|sign\s*in|log\s*in|access denied|cloudflare/i;
// 从 HTML 提取链接的模式集合
//   HREF        : <a href>, <link href>, data-url / data-href
//   BUTTON_URL  : window.location='...' / location.assign('...') 跳转
//   ONCLICK     : <button onclick="..."> 跳路由(React/Vue SPA 常用)
//   DATA_APPLY  : data-apply-url / data-link / data-action 属性
const HREF = /(?:href|data-url|data-href)\s*=\s*["']([^"']+)["']/gi;
const BUTTON_URL = /(?:window\.location(?:\.href)?\s*=|location\.assign\()\s*["']([^"']+)["']/gi;
const ONCLICK = /\bon(?:click|tap)\s*=\s*["'][^"']*(?:location(?:\.href)?\s*=|navigate\s*\(|push\s*\(|assign\s*\(|href\s*=)\s*['"]([^'"]+)['"]/gi;
const DATA_APPLY = /\bdata-(?:apply-url|action-url|target-url|link|action|apply|apply-href)\s*=\s*["']([^"']+)["']/gi;

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function absolute(value, base) { try { return new URL(value, base).href; } catch { return ''; } }
function role(url, text = '') { const value = `${url} ${text}`; if (/(?:\/apply|\/application|submit-resume|create-account)/i.test(url)) return 'DIRECT_APPLICATION'; if (/(?:jobid|positionid|job\/[^/]+|position\/[^/]+|detail)/i.test(url)) return 'JOB_DETAIL'; if (/(?:job-list|joblist|positions?|search-jobs|jobs?\b)/i.test(url)) return 'JOB_LIST'; if (APPLY_TEXT.test(text)) return 'DIRECT_APPLICATION'; if (JOB_TEXT.test(text)) return 'JOB_LIST'; return 'UNKNOWN'; }
function pick(candidates, wanted) { return candidates.find((item) => item.role === wanted)?.url || ''; }
function bestEntry(result = {}) { return pick(result.candidates || [], 'DIRECT_APPLICATION') || pick(result.candidates || [], 'JOB_DETAIL') || pick(result.candidates || [], 'JOB_LIST') || (result.entry?.url && !isStaticAsset(result.entry.url) ? result.entry.url : ''); }
function safeCandidates(result = {}) { return (result.candidates || []).filter((item) => item && !isStaticAsset(item.url) && item.role && item.role !== 'UNKNOWN'); }
function safeEntry(result = {}) {
  if (!result.entry?.url || isStaticAsset(result.entry.url) || result.entry.role === 'UNKNOWN') return null;
  return result.entry;
}

// SPA 平台列表:HTML 是 JS-rendered React/Vue,politeFetch 拿不到 list,需要 Playwright
// 包含通用 ATS 平台 + 公司自建招聘站(已知 SPA)
const SPA_HOSTS = new Set([
  // 通用 ATS
  'mokahr.com', 'hotjob.cn', 'wecruit.hotjob.cn', 'zhiye.com', 'jobs.feishu.cn',
  // 公司自建招聘站(已知 SPA)
  'vip.com', 'ztgame.com', 'mindray.com', 'hr.ztgame.com', '58.com', 'campus.58.com',
  'dji.com', 'apply.careers.dji.com', 'careers.dji.com',
  'zszhcpa.cn', 'hfbank.com.cn', 'career.hfbank.com.cn',
  // iguopin / 国聘 - 通用招聘聚合(SPA)
  'iguopin.com', 'cncec.iguopin.com',
  // 理想汽车 - 自建 React SPA 招聘站
  'lixiang.com', 'www.lixiang.com',
  // 阳光保险(beisen zhiye 多租户 SPA 镜像)
  'sunzhaopin.sinosig.com', 'sinosig.com',
  // 中国电信 / 国航 / 国家电投 — 已知 SPA
  'chinatelecom.com.cn', 'zhaopin.airchina.com.cn', 'campus.chinatelecom.com.cn',
  // 多家银行/券商 — 已知 SPA
  'zhaopin.cgbchina.com.cn', 'careers.citics.com', 'careers.csc.com.cn', 'careers.dfmc.com.cn',
  'careers.gf.com.cn', 'careers.aliyun.com', 'careers.huawei.com', 'careers.pingan.com.cn',
  'careers.jd.com', 'careers.bilibili.com', 'hr.espressif.com.cn', 'espressif.com.cn',
  // 一些已知 SPA 招聘域名
  'hr.inovance.com', 'recruit.inovance.com', 'careers.tcl.com', 'career.bytedance.com',
]);
// 通用模式:任何 careers. / campus. / apply. / jobs. / hr. / join. / zhaopin. 子域也按 SPA 处理
const SPA_SUBDOMAIN = /^(careers?|campus|apply|jobs?|hr|join|zhaopin|recruitment)\./i;
function isSpaHost(url = '') {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    for (const suffix of SPA_HOSTS) if (host === suffix || host.endsWith(`.${suffix}`)) return true;
    if (SPA_SUBDOMAIN.test(host)) return true;
  } catch { /* ignore */ }
  return false;
}

// Playwright fetcher(异步,需要时 import 避免冷启动开销影响非 SPA 路径)
let _playwrightModule = null;
async function getPlaywright() {
  if (_playwrightModule) return _playwrightModule;
  _playwrightModule = await import('playwright');
  return _playwrightModule;
}

export function createPinnedBrowserPolicy(url, safety = {}) {
  const parsed = new URL(url), host = parsed.hostname.toLowerCase();
  const address = (safety.addresses || []).find((item) => /^[0-9a-f:.]+$/i.test(String(item || '')));
  if (!safety.safe || !address) throw Object.assign(new Error('browser target must have a prevalidated pinned address'), { code: 'UNSAFE_BROWSER_TARGET' });
  return {
    host, address, resolverRule: `MAP ${host} ${address},EXCLUDE localhost`,
    allows(candidate) { try { const value = new URL(candidate); return ['http:', 'https:'].includes(value.protocol) && value.hostname.toLowerCase() === host; } catch { return false; } },
  };
}

export async function playwrightFetch(url, { timeoutMs = 30_000, waitMs = 1500, urlGuard = isPublicFetchTarget } = {}) {
  const policy = createPinnedBrowserPolicy(url, await urlGuard(url));
  const { chromium } = await getPlaywright();
  const browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=${policy.resolverRule}`] });
  try {
    const context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      serviceWorkers: 'block',
    });
    let unsafeRequest = '';
    try {
      await context.route('**/*', async (route) => {
        const requestUrl = route.request().url();
        if (!/^https?:/i.test(requestUrl)) return route.continue();
        if (!policy.allows(requestUrl)) { unsafeRequest = requestUrl; return route.abort('blockedbyclient'); }
        return route.continue();
      });
      const page = await context.newPage();
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      if (unsafeRequest) throw Object.assign(new Error(`unsafe browser request blocked: ${unsafeRequest}`), { code: 'UNSAFE_BROWSER_TARGET' });
      await page.waitForTimeout(waitMs);
      const html = await page.content();
      const finalUrl = page.url();
      if (!policy.allows(finalUrl)) throw Object.assign(new Error('unsafe final browser URL'), { code: 'UNSAFE_BROWSER_TARGET' });
      return {
        ok: response?.ok() ?? true,
        status: response?.status() ?? 200,
        url: finalUrl,
        text: async () => html,
      };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

// 智能 fetcher:SPA 用 Playwright,其它用 politeFetch
export async function smartFetch(url, options = {}) {
  if (!isSpaHost(url)) return politeFetch(url, options);
  const { httpFetcher = politeFetch, browserFetcher = playwrightFetch, ...fetchOptions } = options;
  try {
    const response = await httpFetcher(url, fetchOptions);
    const html = response?.clone ? await response.clone().text().catch(() => '') : '';
    if (response?.ok && extractRecruitmentActionLinks(html, response.url || url).length) return response;
  } catch { /* continue to normal browser rendering */ }
  return browserFetcher(url, fetchOptions);
}
function drillRoots(record = {}) {
  // 排除无意义的 URL(browser-not-support、错误页)
  const isJunkUrl = (u = '') => /\/browser-not-support(\b|$)|\/404(\b|$)|\/error(\b|$)|\/not-found(\b|$)/i.test(u);
  const candidates = [
    record.resolvedLinks?.companyCareerHomeUrl,
    record.resolvedLinks?.campaignLandingUrl,
    record.resolvedLinks?.jobListUrl,
    record.recruitmentLinks?.companyCareerHomeUrl,
    record.recruitmentLinks?.campaignLandingUrl,
    record.recruitmentLinks?.jobListUrl,
  ];
  // 优先非 junk;如果都是 junk,从 sourceLinks / assessments 里找同 host 替代
  // Fallback 1:从 sourceLinks / assessments 里找可作为 apply 入口的 URL
  //   - 同 host 非 junk URL(原行为,覆盖 browser-not-support 同 host 替代)
  //   - nowcoder / gankinterview 公告:URL 本身含 job id,可直接当 apply 入口
  const allUrls = [
    ...(record.sourceLinks || []).map((item) => item.url).filter(Boolean),
    ...(record.recruitmentLinks?.assessments || []).flatMap((a) => [a.originalUrl, a.canonicalUrl, a.finalUrl]).filter(Boolean),
  ];
  // 优先:nowcoder / gank 公告(本身就是 apply 入口)
  // 其次:同 host 替代
  // Fallback 失败,所有 candidates 都是 junk 或找不到真实 URL → 返空
  return [...new Set([...candidates, ...allUrls].filter((url) => url && !isStaticAsset(url) && !isJunkUrl(url)))];
}
function drillRoot(record = {}) { return drillRoots(record)[0] || ''; }
function cacheKey(record = {}, root = '') { return createHash('sha1').update(`${record.projectId || record.id || ''}|${record.company || ''}|${root}`).digest('hex'); }
function cacheValid(entry, now) { return entry && Number(entry.expiresAt || 0) > now; }
function ttlMs(result = {}) { return result.status === 'entry_found' ? 86_400_000 : result.status === 'no_confirmed_root' ? 3 * 86_400_000 : 86_400_000; }
export function applyDrillResult(record = {}, result = {}, now = Date.now()) {
  if (!result || !['entry_found','no_action_found'].includes(result.status)) return record;
  const candidates = safeCandidates(result);
  const entry = safeEntry(result);
  const applyUrl = pick(candidates, 'DIRECT_APPLICATION');
  const jobDetailUrl = pick(candidates, 'JOB_DETAIL');
  const jobListUrl = pick(candidates, 'JOB_LIST');
  const fallbackEntryUrl = entry?.url && !isStaticAsset(entry.url) ? entry.url : '';
  const frontUrl = applyUrl || jobDetailUrl || jobListUrl || fallbackEntryUrl;
  const verifiedEntry = Boolean(result.verification?.reachable === 'yes' && result.verification?.officialIdentityConfirmed === 'yes' && (jobListUrl || jobDetailUrl || applyUrl));
  const recruitmentLinks = { ...(record.recruitmentLinks || {}), companyCareerHomeUrl: record.recruitmentLinks?.companyCareerHomeUrl || record.resolvedLinks?.companyCareerHomeUrl || (result.root && !isStaticAsset(result.root) ? result.root : null) || null, jobListUrl: jobListUrl || null, jobDetailUrl: jobDetailUrl || null, applyUrl: applyUrl || null, finalUrl: frontUrl || record.recruitmentLinks?.finalUrl || null, urlRole: applyUrl ? 'application_form' : jobDetailUrl ? 'job_detail' : jobListUrl ? 'job_list' : record.recruitmentLinks?.urlRole || 'company_career_home' };
  const resolvedLinks = { ...(record.resolvedLinks || {}), companyCareerHomeUrl: record.resolvedLinks?.companyCareerHomeUrl || result.root || null, jobListUrl: jobListUrl || null, jobDetailUrl: jobDetailUrl || null, applyUrl: applyUrl || null, bestAvailableUrl: frontUrl || record.resolvedLinks?.bestAvailableUrl || null, bestAvailableUrlLabel: applyUrl ? 'verified application entry' : jobDetailUrl ? 'verified job detail' : jobListUrl ? 'verified job list' : record.resolvedLinks?.bestAvailableUrlLabel || null };
  return { ...record, recruitmentLinks, resolvedLinks, officialUrl: frontUrl || record.officialUrl || '', primaryUrl: frontUrl || record.primaryUrl || '', finalApplyUrl: applyUrl || record.finalApplyUrl || '', detailUrl: jobDetailUrl || record.detailUrl || '', officialVerified: verifiedEntry || record.officialVerified === true, reachable: result.verification?.reachable === 'yes' || record.reachable === true, officialIdentityConfirmed: result.verification?.officialIdentityConfirmed === 'yes' || record.officialIdentityConfirmed === true, hasJobList: Boolean(jobListUrl) || record.hasJobList === true, hasApplicationAction: Boolean(applyUrl) || record.hasApplicationAction === true, applicationActive: result.verification?.applicationActive === 'no' ? false : frontUrl ? true : record.applicationActive ?? null, verificationStatus: verifiedEntry ? 'active_verified_entry' : record.verificationStatus || 'official_source_found', verificationState: verifiedEntry ? 'VERIFIED' : record.verificationState || 'UNVERIFIED', verificationCheckedAt: now, lastVerifiedAt: verifiedEntry ? now : record.lastVerifiedAt || null };
}

export function extractRecruitmentActionLinks(html = '', baseUrl = '') {
  const links = new Map();
  for (const regex of [HREF, BUTTON_URL, ONCLICK, DATA_APPLY]) for (const match of html.matchAll(regex)) {
    const url = absolute(match[1], baseUrl); if (!/^https?:/i.test(url)) continue;
    const context = html.slice(Math.max(0, match.index - 160), Math.min(html.length, match.index + 260));
    links.set(url, { url, role: role(url, context), anchorText: clean(context.replace(/<[^>]+>/g, ' ')).slice(0, 280) });
  }
  return [...links.values()].sort((a, b) => ({ DIRECT_APPLICATION: 4, JOB_DETAIL: 3, JOB_LIST: 2, UNKNOWN: 0 }[b.role] - ({ DIRECT_APPLICATION: 4, JOB_DETAIL: 3, JOB_LIST: 2, UNKNOWN: 0 }[a.role])));
}

export async function drillRecruitmentEntry(record = {}, { registries, fetcher, timeoutMs = 12_000 } = {}) {
  // 默认用 smartFetch:SPA 平台走 Playwright,其它走 politeFetch
  if (!fetcher) fetcher = smartFetch;
  const roots = drillRoots(record);
  // 短路(优先 governance):nowcoder / gankinterview 公告 → URL 本身就是 apply 入口,无需 fetch + governance
  let root = '', identity = null;
  for (const candidateRoot of roots) {
    const classified = classifyGovernedRecruitmentUrl({ company: record.company, url: candidateRoot, registries });
    if (['corporate_domain_confirmed','ats_tenant_confirmed'].includes(classified.decision)) { root = candidateRoot; identity = classified; break; }
  }
  if (!root) return { status: 'no_confirmed_root', candidates: [], entry: null };
  if (!['corporate_domain_confirmed','ats_tenant_confirmed'].includes(identity.decision)) return { status: 'unconfirmed_identity', candidates: [], entry: null };
  // 信任根 host:同一 host 下的链接不再逐个走 governance(避免 Moka/Hotjob 逐个 tenant mapping 的开销)
  let rootHost = '';
  try { rootHost = new URL(root).hostname.toLowerCase().replace(/^www\./, ''); } catch { /* ignored */ }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(root, { headers: { 'user-agent': 'Career-OP/official-entry-resolver' }, signal: controller.signal });
    const html = response.ok ? await response.text() : '';
    const candidates = extractRecruitmentActionLinks(html, response.url || root).filter((item) => {
      if (item.role === 'UNKNOWN' || isStaticAsset(item.url)) return false;
      let host = '';
      try { host = new URL(item.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return false; }
      // 同 host 直接信任(根已经被 governance 验证)
      if (rootHost && host === rootHost && identity.decision === 'corporate_domain_confirmed') return true;
      // 跨 host 仍走 governance 校验
      const candidate = classifyGovernedRecruitmentUrl({ company: record.company, url: item.url, registries });
      return ['corporate_domain_confirmed','ats_tenant_confirmed'].includes(candidate.decision);
    });
    if ([401, 403, 429].includes(Number(response.status)) || (!candidates.length && ACCESS_RESTRICTED_TEXT.test(html))) {
      return { status: 'manual_review', reason: 'login_captcha_or_access_control', root, candidates: [], entry: null, verification: { reachable: response.ok ? 'yes' : 'no', officialIdentityConfirmed: 'yes', campaignConfirmed: 'unknown', hasJobList: 'unknown', hasApplicationAction: 'unknown', applicationActive: 'unknown' } };
    }
    const entry = candidates[0] || null;
    return { status: response.ok ? (entry ? 'entry_found' : 'no_action_found') : `http_${response.status}`, root, candidates, entry, verification: { reachable: response.ok ? 'yes' : 'no', officialIdentityConfirmed: 'yes', campaignConfirmed: 'unknown', hasJobList: candidates.some((item) => item.role === 'JOB_LIST') ? 'yes' : 'no', hasApplicationAction: candidates.some((item) => item.role === 'DIRECT_APPLICATION') ? 'yes' : 'no', applicationActive: CLOSED_TEXT.test(html) ? 'no' : entry ? 'unknown' : 'unknown' } };
  } catch (error) { return { status: error?.name === 'AbortError' ? 'timeout' : 'request_error', candidates: [], entry: null }; } finally { clearTimeout(timer); }
}

export async function resolveApplyEntriesForRecords(records = [], { registries, cache = {}, fetcher, timeoutMs = 12_000, limit = records.length, force = false, now = Date.now() } = {}) {
  // 默认用 smartFetch:SPA 走 Playwright,其它走 politeFetch
  if (!fetcher) fetcher = smartFetch;
  const output = [];
  const entries = [];
  const summary = { total: records.length, eligible: 0, drilled: 0, cacheHits: 0, entryFound: 0, skippedAlreadyVerified: 0, skippedNoRoot: 0, errors: 0 };
  for (const record of records) {
    const alreadyUsable = record.resolvedLinks?.applyUrl || record.resolvedLinks?.jobDetailUrl || record.resolvedLinks?.jobListUrl;
    if (alreadyUsable && !force) { summary.skippedAlreadyVerified += 1; output.push(record); continue; }
    const root = drillRoot(record);
    if (!root) { summary.skippedNoRoot += 1; output.push(record); continue; }
    if (summary.drilled >= Number(limit || records.length)) { output.push(record); continue; }
    summary.eligible += 1;
    const key = cacheKey(record, root);
    let result = null;
    if (!force && cacheValid(cache[key], now)) {
      result = cache[key].result;
      summary.cacheHits += 1;
    } else {
      result = await drillRecruitmentEntry(record, { registries, fetcher, timeoutMs });
      cache[key] = { checkedAt: now, expiresAt: now + ttlMs(result), projectId: record.projectId || record.id, root, result };
      summary.drilled += 1;
    }
    if (result.status === 'entry_found') summary.entryFound += 1;
    if (result.status === 'no_confirmed_root') summary.skippedNoRoot += 1;
    if (['request_error','timeout'].includes(result.status)) summary.errors += 1;
    entries.push({ projectId: record.projectId || record.id, company: record.company, root, status: result.status, entry: bestEntry(result), candidates: result.candidates || [], cacheHit: cacheValid(cache[key], now) && summary.drilled === 0 });
    output.push(applyDrillResult(record, result, now));
  }
  return { records: output, cache, entries, summary };
}

const RECRUITMENT_ROLE_KEYS = ['companyCareerHomeUrl', 'campaignLandingUrl', 'jobListUrl', 'jobDetailUrl', 'applyUrl'];
const FORBIDDEN_ENTRY_DECISIONS = new Set([
  'aggregator_source', 'university_repost', 'government_repost', 'media_article',
  'wechat_identity_unproven', 'missing_or_dead',
]);

function uniqueUrls(values = []) {
  return [...new Set(values.filter(Boolean).map((value) => String(value).trim()).filter(Boolean))];
}

function entryAssessment(company, url, registries) {
  return classifyGovernedRecruitmentUrl({ company, url, registries });
}

function isAllowedEntryAssessment(assessment, key) {
  if (assessment.decision === 'official_wechat_announcement') return ['campaignLandingUrl', 'detailUrl'].includes(key);
  if (!['corporate_domain_confirmed', 'ats_tenant_confirmed'].includes(assessment.decision)) return false;
  const allowedRoles = {
    companyCareerHomeUrl: ['company_career_home'],
    campaignLandingUrl: ['campaign_announcement'],
    jobListUrl: ['job_list'],
    jobDetailUrl: ['application_form'],
    applyUrl: ['application_form'],
    finalApplyUrl: ['application_form'],
    detailUrl: ['application_form', 'job_list', 'campaign_announcement', 'company_career_home'],
    officialUrl: ['application_form', 'job_list', 'campaign_announcement', 'company_career_home'],
    primaryUrl: ['application_form', 'job_list', 'campaign_announcement', 'company_career_home'],
  };
  return (allowedRoles[key] || []).includes(assessment.urlRole);
}

export function sanitizeRecruitmentEntryRecord(input = {}, registries) {
  const record = structuredClone(input);
  record.resolvedLinks = { ...(record.resolvedLinks || {}) };
  record.recruitmentLinks = { ...(record.recruitmentLinks || {}) };
  const removed = [];
  const candidates = [];
  const removeIfForbidden = (container, key) => {
    const url = container[key];
    if (!url) return;
    const assessment = entryAssessment(record.company, url, registries);
    if (isAllowedEntryAssessment(assessment, key)) return;
    if (['unknown', 'ats_platform_recognized'].includes(assessment.decision)) candidates.push(url);
    removed.push(url);
    container[key] = null;
  };
  for (const key of RECRUITMENT_ROLE_KEYS) {
    removeIfForbidden(record.resolvedLinks, key);
    removeIfForbidden(record.recruitmentLinks, key);
  }
  let roleDeduped = false;
  const seenRoleUrls = new Set();
  for (const key of ['applyUrl', 'jobDetailUrl', 'jobListUrl', 'campaignLandingUrl', 'companyCareerHomeUrl']) {
    const url = record.resolvedLinks[key] || record.recruitmentLinks[key] || '';
    if (!url) continue;
    if (seenRoleUrls.has(url)) {
      if (record.resolvedLinks[key]) record.resolvedLinks[key] = null;
      if (record.recruitmentLinks[key]) record.recruitmentLinks[key] = null;
      roleDeduped = true;
    } else {
      seenRoleUrls.add(url);
    }
  }
  for (const key of ['finalApplyUrl', 'applyUrl', 'detailUrl', 'officialUrl', 'primaryUrl']) {
    if (record[key] && !isAllowedEntryAssessment(entryAssessment(record.company, record[key], registries), key)) {
      removed.push(record[key]);
      record[key] = '';
    }
  }

  const removedUrls = uniqueUrls(removed);
  if (!removedUrls.length && !roleDeduped) return { record: input, changed: false, removedUrls: [] };

  const sourceDocumentUrls = uniqueUrls([
    ...(record.resolvedLinks.sourceDocumentUrls || []),
    ...(record.recruitmentLinks.sourceDocumentUrls || []),
    record.recruitmentLinks.sourceDocumentUrl,
    record.sourceDocumentUrl,
    ...removedUrls,
  ]);
  record.resolvedLinks.sourceDocumentUrls = sourceDocumentUrls;
  record.resolvedLinks.candidateOfficialUrl = record.resolvedLinks.candidateOfficialUrl || uniqueUrls(candidates)[0] || null;
  record.recruitmentLinks.sourceDocumentUrls = sourceDocumentUrls;
  record.recruitmentLinks.sourceDocumentUrl = record.recruitmentLinks.sourceDocumentUrl || sourceDocumentUrls[0] || null;
  record.sourceDocumentUrl = record.sourceDocumentUrl || sourceDocumentUrls[0] || '';

  const cleanApply = record.resolvedLinks.applyUrl || record.recruitmentLinks.applyUrl || '';
  const cleanDetail = record.resolvedLinks.jobDetailUrl || record.recruitmentLinks.jobDetailUrl || '';
  const cleanList = record.resolvedLinks.jobListUrl || record.recruitmentLinks.jobListUrl || '';
  const cleanCampaign = record.resolvedLinks.campaignLandingUrl || record.recruitmentLinks.campaignLandingUrl || '';
  const cleanHome = record.resolvedLinks.companyCareerHomeUrl || record.recruitmentLinks.companyCareerHomeUrl || '';
  const best = cleanApply || cleanDetail || cleanList || cleanCampaign || cleanHome;
  record.finalApplyUrl = cleanApply || cleanDetail || cleanList || '';
  record.detailUrl = cleanDetail || cleanList || cleanCampaign || cleanHome || '';
  record.officialUrl = best || '';
  record.primaryUrl = best || '';
  record.hasJobList = Boolean(cleanList || cleanDetail || cleanApply);
  record.hasApplicationAction = Boolean(cleanApply);
  const verifiedEntry = Boolean(cleanList || cleanDetail || cleanApply);
  record.officialVerified = verifiedEntry;
  record.officialIdentityConfirmed = Boolean(best);
  record.verificationState = verifiedEntry ? 'VERIFIED' : 'UNVERIFIED';
  record.verificationStatus = verifiedEntry ? 'active_verified_entry' : 'source_only';
  if (!verifiedEntry) record.lastVerifiedAt = null;
  return { record, changed: true, removedUrls };
}

export function sanitizeRecruitmentEntryRecords(records = [], registries) {
  const output = [];
  const changedRecordIds = [];
  const removedUrls = new Set();
  for (const input of records) {
    const result = sanitizeRecruitmentEntryRecord(input, registries);
    output.push(result.record);
    if (result.changed) changedRecordIds.push(input.projectId || input.id || '');
    for (const url of result.removedUrls) removedUrls.add(url);
  }
  return {
    records: output,
    summary: {
      total: records.length,
      changed: changedRecordIds.length,
      unchanged: records.length - changedRecordIds.length,
      removedUrlCount: removedUrls.size,
      changedRecordIds,
    },
  };
}

export function applyEntryCoverageReport(records = []) {
  const projectIds = new Set(records.map((record) => record.projectId || record.id));
  const one = (fn) => new Set(records.filter(fn).map((record) => record.projectId || record.id)).size;
  return { generatedAt: new Date().toISOString(), totalRecruitmentProjects: projectIds.size, companyCareerHomes: one((r) => r.resolvedLinks?.companyCareerHomeUrl), campaignLandingPages: one((r) => r.resolvedLinks?.campaignLandingUrl), jobLists: one((r) => r.resolvedLinks?.jobListUrl), jobDetails: one((r) => r.resolvedLinks?.jobDetailUrl), directApplyPages: one((r) => r.resolvedLinks?.applyUrl), candidateApplyEntries: one((r) => r.resolvedLinks?.candidateApplyUrl), sourceOnly: one((r) => !r.resolvedLinks?.candidateOfficialUrl && r.resolvedLinks?.bestAvailableUrl), noOfficialEntry: one((r) => !r.resolvedLinks?.companyCareerHomeUrl && !r.resolvedLinks?.jobListUrl && !r.resolvedLinks?.applyUrl), expiredEntries: one((r) => r.staleOrExpired), automaticEntries: one((r) => r.resolvedLinks?.applyUrl || r.resolvedLinks?.jobListUrl), manualHandlingRequired: one((r) => !r.resolvedLinks?.applyUrl && !r.resolvedLinks?.jobListUrl) };
}
