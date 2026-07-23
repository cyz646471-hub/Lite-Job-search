import { canonicalizeCandidateUrl, registrableDomainOf } from './cn-url-evidence.mjs';

const POSITIVE = /招聘|职位|岗位|人才|校招|社招|实习|加入我们|career|careers|job|jobs|position|campus|apply/i;
const NEGATIVE = /新闻|产品|投资者关系|帮助|隐私政策|普通登录|用户中心|news|product|investor|privacy|help/i;
const ROLE_SCORE = { APPLY: 6, JOB_DETAIL: 5, JOB_LIST: 4, CAMPAIGN: 3, CAREER_HOME: 2, CORPORATE_HOME: 1, UNKNOWN: 0 };

function absolute(value, base) { return canonicalizeCandidateUrl(value, base); }
function visibleText(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }

function extractLinks(html, baseUrl) {
  const links = [];
  const add = (value, text = '') => { const url = absolute(value, baseUrl); if (url && url !== baseUrl && !/\.(?:css|js|png|jpe?g|gif|svg|ico|woff2?)(?:\?|$)/i.test(url)) links.push({ url, text: String(text || '').replace(/<[^>]+>/g, ' ').trim() }); };
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) add(match[1], match[2]);
  for (const match of html.matchAll(/<(?:button|div|a)\b[^>]*(?:data-url|data-href|data-link|data-apply-url)=["']([^"']+)["'][^>]*>([\s\S]*?)<\/(?:button|div|a)>/gi)) add(match[1], match[2]);
  for (const match of html.matchAll(/<form\b[^>]*action=["']([^"']+)["'][^>]*>([\s\S]*?)<\/form>/gi)) add(match[1], match[2]);
  for (const match of html.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)) add(match[1], 'iframe');
  for (const match of html.matchAll(/(?:window\.open|navigate|location(?:\.href)?)\s*\(?\s*["']([^"']+)["']/gi)) add(match[1], 'script route');
  return [...new Map(links.map((item) => [item.url, item])).values()];
}

export function extractRecruitmentTargetEvidence(html = '', parsed = null, url = '') {
  const heading = String(html.match(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/i)?.[1] || '').replace(/<[^>]+>/g, ' ');
  const selected = [...String(html).matchAll(/<[^>]+(?:aria-current=["'](?:page|true)["']|data-selected=["']true["']|class=["'][^"']*\b(?:active|selected|current)\b[^"']*["'])[^>]*>([\s\S]*?)<\/[^>]+>/gi)].map((match) => String(match[1]).replace(/<[^>]+>/g, ' ')).join(' ');
  const activeJobEvidence = (parsed?.activeJobs || []).map((job) => `${job.scope || ''} ${job.recruitmentType || job.batch || ''} ${job.cohortYear || ''} ${job.title || ''}`).join(' ');
  const text = `${url} ${heading} ${selected} ${activeJobEvidence}`, scopes = new Set(), cohortYears = new Set(), recruitmentBatches = new Set();
  const parsedScopes = parsed?.recruitmentScope || parsed?.recruitmentScopes || parsed?.recruitmentChannels || [];
  for (const value of (Array.isArray(parsedScopes) ? parsedScopes : [parsedScopes])) {
    const normalized = String(value || '').toUpperCase();
    if (/INTERN/.test(normalized)) scopes.add('INTERN');
    else if (/SOCIAL/.test(normalized)) scopes.add('SOCIAL');
    else if (/CAMPUS/.test(normalized)) scopes.add('CAMPUS');
  }
  const hasInternScope = /实习|intern/i.test(text);
  const hasSocialScope = /社会招聘|社招|experienced hire|\/social(?:\/|$)/i.test(text);
  if (hasInternScope) scopes.add('INTERN');
  if (hasSocialScope) scopes.add('SOCIAL');
  if (!hasInternScope && !hasSocialScope && /校园招聘|校招|应届|graduate program|graduate|campus/i.test(text)) scopes.add('CAMPUS');
  if (/暑期实习|summer[_ -]?intern/i.test(text)) recruitmentBatches.add('SUMMER_INTERNSHIP');
  if (/日常实习|长期实习|daily[_ -]?intern|off[- ]?cycle intern/i.test(text)) recruitmentBatches.add('DAILY_INTERNSHIP');
  if (/秋招|秋季校园招聘|\bautumn\b/i.test(text)) recruitmentBatches.add('AUTUMN');
  if (/春招|春季校园招聘|\bspring\b/i.test(text)) recruitmentBatches.add('SPRING');
  if (/提前批|early[_ -]?batch|\bearly\b/i.test(text)) recruitmentBatches.add('EARLY');
  if (/补录|追加招聘|\bsupplementary\b/i.test(text)) recruitmentBatches.add('SUPPLEMENTARY');
  for (const match of text.matchAll(/(20\d{2})\s*届/g)) cohortYears.add(Number(match[1]));
  return { recruitmentScopes: [...scopes], cohortYears: [...cohortYears].sort(), recruitmentBatches: [...recruitmentBatches] };
}

function hintedRole(item) {
  const blob = `${item.url} ${item.text}`;
  if (/立即投递|立即申请|申请职位|apply(?:\b|\/|\?)/i.test(blob)) return 'APPLY';
  if (/岗位职责|任职要求|职位详情|job\/[^/]+|position\/[^/]+|jobId=|positionId=/i.test(blob)) return 'JOB_DETAIL';
  if (/职位列表|招聘岗位|查看职位|view jobs|search jobs|\/(?:jobs?|positions?)(?:\/|\?|$)/i.test(blob)) return 'JOB_LIST';
  if (/校招|校园招聘|实习|campus|intern/i.test(blob)) return 'CAMPAIGN';
  if (/招聘|加入我们|career|join/i.test(blob)) return 'CAREER_HOME';
  return 'UNKNOWN';
}

export function classifySurfacePage({ url = '', html = '', status = 200, parsed = null } = {}) {
  const text = visibleText(html), links = extractLinks(html, url), blob = `${url} ${text}`;
  const h1 = String(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, ' ');
  if ([401, 403, 429].includes(Number(status)) || /验证码|安全验证|访问过于频繁|captcha|access denied/i.test(blob)) return { url, pageState: 'BLOCKED_OR_CAPTCHA', pageRole: 'UNKNOWN', vacancyStatus: 'BLOCKED', links };
  if (parsed?.blocked) return { url, pageState: 'BLOCKED_OR_CAPTCHA', pageRole: parsed.pageRole || 'UNKNOWN', vacancyStatus: 'BLOCKED', links };
  if (parsed?.expiredCampaign || /招聘已结束|已截止|停止申请|no longer accepting/i.test(blob)) return { url, pageState: 'EXPIRED_CAMPAIGN', pageRole: parsed?.pageRole || 'CAMPAIGN', vacancyStatus: 'EXPIRED', links };
  if (parsed?.noOpenings || parsed?.jobCount === 0 && Array.isArray(parsed?.activeJobs) && parsed.activeJobs.length === 0 || /暂无(?:开放)?职位|暂无岗位|没有在招职位|no open(?:ing| position| job)/i.test(blob)) return { url, pageState: 'VERIFIED_NO_OPENINGS', pageRole: parsed?.pageRole === 'CAMPAIGN' ? 'CAMPAIGN' : 'CAREER_HOME', vacancyStatus: 'NO_OPENINGS', links };
  const hints = links.map(hintedRole);
  const currentIsApply = /(?:^|\/)apply(?:\.html|\/|$)|application(?:\/|$)/i.test((() => { try { return new URL(url).pathname; } catch { return ''; } })())
    && /提交简历|确认申请|提交申请|创建账号后申请|apply now|submit application/i.test(text);
  if (currentIsApply || (parsed?.pageRole === 'APPLY' && parsed.applyUrl && canonicalizeCandidateUrl(parsed.applyUrl, url) === canonicalizeCandidateUrl(url))) return { url, pageState: 'APPLY_ACTION', pageRole: 'APPLY', vacancyStatus: 'ACTIVE', links };
  if (parsed?.jobDetailUrl || (/岗位职责|任职要求|responsibilit|qualification/i.test(blob) && !/多个职位|职位列表/i.test(blob))) return { url, pageState: 'ACTIVE_JOB_DETAIL', pageRole: 'JOB_DETAIL', vacancyStatus: 'ACTIVE', links };
  if (parsed?.jobListUrl || parsed?.activeJobs?.length || hints.filter((role) => role === 'JOB_DETAIL').length >= 2 || /招聘职位|职位列表|岗位列表|open positions/i.test(blob)) return { url, pageState: 'ACTIVE_JOB_LIST', pageRole: 'JOB_LIST', vacancyStatus: 'ACTIVE', links };
  if (/加入我们|人才招聘|招聘官网|careers|join us/i.test(h1 || blob) && !/20\d{2}届|暑期实习|日常实习/i.test(h1)) return { url, pageState: 'VERIFIED_CAREER_HOME', pageRole: 'CAREER_HOME', vacancyStatus: 'UNKNOWN', links };
  if (/20\d{2}届|校园招聘|校招|暑期实习|日常实习|campus|summer intern/i.test(blob)) return { url, pageState: 'VERIFIED_CAMPAIGN', pageRole: 'CAMPAIGN', vacancyStatus: 'UNKNOWN', links };
  return { url, pageState: 'UNKNOWN', pageRole: 'UNKNOWN', vacancyStatus: 'UNKNOWN', links };
}

export function needsSurfaceBrowserRender({
  resolvedStatus,
  url = '',
  html = '',
  status = 200,
  parsed = null,
} = {}) {
  if (resolvedStatus !== 'RESOLVED') return false;
  const classified = classifySurfacePage({ url, html, status, parsed });
  if (classified.pageRole === 'UNKNOWN') return true;
  const parsedHasContentSignal = parsed?.pageRole
    || parsed?.jobListUrl
    || parsed?.jobDetailUrl
    || Number.isFinite(Number(parsed?.jobCount))
    || (parsed?.activeJobs || []).length > 0;
  return !parsedHasContentSignal && visibleText(html).length < 200;
}

function allowed(surface, url) {
  const root = registrableDomainOf(url);
  if (!root || root !== (surface.registrableDomain || registrableDomainOf(surface.canonicalUrl))) return false;
  if (surface.vendor !== 'SELF_HOSTED' && surface.tenantKey) {
    const value = decodeURIComponent(url).toLowerCase(), tenant = String(surface.tenantKey).toLowerCase(), target = new URL(url);
    const surfaceHost = new URL(surface.canonicalUrl).hostname.toLowerCase(), targetHost = target.hostname.toLowerCase();
    const explicitTenant = surface.vendor === 'MOKA' ? target.pathname.match(/(?:campus-recruitment|social-recruitment|recommendation)\/([^/]+)/i)?.[1]
      : surface.vendor === 'HOTJOB' ? target.pathname.match(/\/(SU[^/]+)/i)?.[1]
        : ['FEISHU', 'BEISEN'].includes(surface.vendor) && !['www', 'jobs', 'app'].includes(targetHost.split('.')[0]) ? targetHost.split('.')[0] : '';
    if (explicitTenant && explicitTenant.toLowerCase() !== tenant) return false;
    if (targetHost === surfaceHost && (surfaceHost.startsWith(`${tenant}.`) || value.includes(`/${tenant}/`) || value.includes(surface.tenantKey.toLowerCase()))) return true;
    return targetHost === surfaceHost && !/\/(?:tenant|company)\/[^/]+/i.test(target.pathname);
  }
  return true;
}

export async function boundedSurfaceDrill(surface, { fetchPage, parsePage = null, targetScope = '', maxDepth = 2, maxNodes = 25, domainDelayMs = 0, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), nowFn = Date.now } = {}) {
  if (!surface?.canonicalUrl || surface.identityStatus !== 'VERIFIED') return { status: 'UNVERIFIED_SURFACE', best: null, visited: [] };
  const normalizedTargetScope = /INTERN|实习/i.test(String(targetScope)) ? 'INTERN'
    : /SOCIAL|社招|社会招聘/i.test(String(targetScope)) ? 'SOCIAL'
      : /CAMPUS|校招|应届/i.test(String(targetScope)) ? 'CAMPUS' : '';
  const root = canonicalizeCandidateUrl(surface.canonicalUrl), queue = [{ url: root, depth: 0, score: 100 }], seen = new Set(), visited = [], discoveries = [], lastFetchByDomain = new Map();
  while (queue.length && visited.length < maxNodes) {
    queue.sort((a, b) => b.score - a.score);
    const item = queue.shift();
    if (seen.has(item.url) || !allowed(surface, item.url)) continue;
    seen.add(item.url);
    let page;
    try {
      const domain = registrableDomainOf(item.url), last = lastFetchByDomain.get(domain);
      if (last != null && domainDelayMs > 0) { const waitMs = Math.max(0, domainDelayMs - (nowFn() - last)); if (waitMs) await sleep(waitMs); }
      page = await fetchPage(item.url); lastFetchByDomain.set(domain, nowFn());
    } catch { visited.push({ url: item.url, pageState: 'BLOCKED_OR_CAPTCHA', pageRole: 'UNKNOWN', vacancyStatus: 'BLOCKED', reasonCode: 'network_error' }); continue; }
    const html = page?.html || page?.body || '', parsed = parsePage ? await parsePage(html, { requestedUrl: item.url, finalUrl: page?.finalUrl || page?.url || item.url }) : null;
    const classifiedUrl = page?.finalUrl || page?.url || item.url;
    const classified = { ...classifySurfacePage({ url: classifiedUrl, html, status: page?.status, parsed }), ...extractRecruitmentTargetEvidence(html, parsed, classifiedUrl) };
    visited.push(classified); discoveries.push(classified);
    if (classified.vacancyStatus === 'BLOCKED') continue;
    for (const link of classified.links || []) {
      if (!allowed(surface, link.url) || NEGATIVE.test(`${link.url} ${link.text}`)) continue;
      const role = hintedRole(link);
      const linkScope = /intern|实习/i.test(`${link.url} ${link.text}`) ? 'INTERN'
        : /social|社招|社会招聘/i.test(`${link.url} ${link.text}`) ? 'SOCIAL'
          : /graduate|campus|校招|应届/i.test(`${link.url} ${link.text}`) ? 'CAMPUS' : '';
      const scopeBonus = normalizedTargetScope && linkScope === normalizedTargetScope ? 50 : normalizedTargetScope && linkScope && linkScope !== normalizedTargetScope ? -30 : 0;
      if (item.depth < maxDepth && (role !== 'UNKNOWN' || POSITIVE.test(`${link.url} ${link.text}`))) queue.push({ url: link.url, depth: item.depth + 1, score: ROLE_SCORE[role] * 10 - item.depth + scopeBonus });
    }
    if (classified.pageRole === 'APPLY' && classified.vacancyStatus === 'ACTIVE') break;
  }
  const usable = discoveries.filter((entry) => entry.vacancyStatus !== 'BLOCKED');
  const chooseBestForScope = (scope) => {
    const scopeMatched = scope ? usable.filter((entry) => entry.recruitmentScopes?.includes(scope)) : [];
    const selectionPool = scopeMatched.length ? scopeMatched : scope ? usable.filter((entry) => !entry.recruitmentScopes?.length) : usable;
    const scopeSpecificity = (entry) => {
    if (!scope) return 0;
    const value = `${entry.url || ''}`;
    if (scope === 'INTERN') return /intern|实习/i.test(value) ? 2 : 0;
    if (scope === 'SOCIAL') return /social|社招/i.test(value) ? 2 : 0;
    if (scope === 'CAMPUS') return /graduate|应届/i.test(value) ? 2 : /campus|校招/i.test(value) ? 1 : 0;
    return 0;
    };
    return [...(selectionPool.length ? selectionPool : usable)].sort((a, b) => scopeSpecificity(b) - scopeSpecificity(a) || (ROLE_SCORE[b.pageRole] || 0) - (ROLE_SCORE[a.pageRole] || 0) || Number(b.directAction === true) - Number(a.directAction === true))[0] || null;
  };
  const bestByScope = { INTERN: chooseBestForScope('INTERN'), CAMPUS: chooseBestForScope('CAMPUS'), SOCIAL: chooseBestForScope('SOCIAL') };
  const best = normalizedTargetScope ? bestByScope[normalizedTargetScope] : chooseBestForScope('');
  return { status: visited.some((entry) => entry.vacancyStatus === 'BLOCKED') && !best ? 'BLOCKED' : 'COMPLETE', best, bestByScope, visited, discoveries, targetScope: normalizedTargetScope, limits: { maxDepth, maxNodes, domainDelayMs }, nodesVisited: visited.length };
}
