import { parseJobPostingJsonLd } from './_jsonld.mjs';

function absolute(value, baseUrl) {
  try { return new URL(value, baseUrl).href; } catch { return ''; }
}

function extractUrls(html, baseUrl) {
  const values = [];
  for (const pattern of [/\bwindow\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});/, /\bwindow\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\});/]) {
    const match = html.match(pattern);
    if (!match) continue;
    for (const urlMatch of match[1].matchAll(/["'](https?:\/\/[^"']+)/g)) values.push(urlMatch[1]);
  }
  const noscript = [...html.matchAll(/<noscript[^>]*>([\s\S]*?)<\/noscript>/gi)].map((match) => match[1]).join('\n');
  for (const match of noscript.matchAll(/href=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of html.matchAll(/(?:href|data-url|data-href|data-link|data-apply-url|action)=["']([^"']+)["']/gi)) {
    if (/apply|application|job|position|career|campus|recruit/i.test(match[1])) values.push(match[1]);
  }
  return [...new Set(values.map((value) => absolute(value, baseUrl)).filter((url) => /^https?:/i.test(url) && /job|position|recruit|career|hire|campus|apply|intern/i.test(url)))];
}

function parseStateBlocks(html) {
  const values = [];
  for (const match of html.matchAll(/<script[^>]*(?:id=["'](?:__NEXT_DATA__|__INITIAL_STATE__)["']|type=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { values.push(JSON.parse(match[1].trim())); } catch { /* malformed hydration remains a browser fallback */ }
  }
  for (const match of html.matchAll(/window\.(?:__INITIAL_STATE__|__NEXT_DATA__)\s*=\s*(\{[\s\S]*?\});/gi)) {
    try { values.push(JSON.parse(match[1])); } catch { /* ignore */ }
  }
  return values;
}

function walk(value, visit, path = []) {
  if (value == null) return;
  visit(value, path);
  if (Array.isArray(value)) value.forEach((item, index) => walk(item, visit, [...path, String(index)]));
  else if (typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, visit, [...path, key]);
}

function firstStateValue(states, keys) {
  let found = '';
  for (const state of states) walk(state, (value, path) => {
    if (found || typeof value !== 'string') return;
    if (keys.includes(String(path.at(-1) || '').toLowerCase()) && value.trim()) found = value.trim();
  });
  return found;
}

function stateUrls(states, baseUrl) {
  const urls = [];
  for (const state of states) walk(state, (value, path) => {
    if (typeof value !== 'string') return;
    const key = String(path.at(-1) || '').toLowerCase();
    if (/url|href|link|route/.test(key) && /^(?:https?:\/\/|\/)/.test(value)) urls.push(absolute(value, baseUrl));
  });
  return urls;
}

function stateJobs(states, baseUrl) {
  const jobs = [];
  for (const state of states) walk(state, (value, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const title = value.title || value.jobName || value.positionName || value.name;
    const id = value.id || value.jobId || value.positionId || value.code;
    if (!title || !id || !/job|position|jobs|positions/i.test(path.join('.'))) return;
    jobs.push({
      id: String(id), title: String(title), location: String(value.location || value.city || value.cityName || ''),
      scope: String(value.scope || value.channel || value.recruitmentScope || value.jobType || ''),
      recruitmentType: String(value.recruitmentType || value.batch || value.campaignType || ''), cohortYear: Number(value.cohortYear || value.graduationYear) || null,
      detailUrl: absolute(value.detailUrl || value.jobUrl || value.url || `/job/${id}`, baseUrl), applyUrl: absolute(value.applyUrl || value.applicationUrl || '', baseUrl),
    });
  });
  return [...new Map(jobs.map((job) => [job.id, job])).values()];
}

function tenantFromUrl(baseUrl, vendor) {
  try {
    const url = new URL(baseUrl), subdomain = url.hostname.split('.')[0];
    if (vendor === 'MOKA') return url.pathname.match(/(?:campus-recruitment|social-recruitment|recommendation)\/([^/]+)/i)?.[1] || (subdomain !== 'app' ? subdomain : '');
    if (vendor === 'HOTJOB') return url.pathname.match(/\/(SU[^/]+)/i)?.[1] || '';
    if (vendor === 'FEISHU') return subdomain !== 'jobs' ? subdomain : '';
    if (vendor === 'BEISEN') return !['www', 'jobs'].includes(subdomain) ? subdomain : '';
    return '';
  } catch { return ''; }
}

function pathOf(value) {
  try { return `${new URL(value).pathname}${new URL(value).search}`; } catch { return ''; }
}

function currentPageStateText(states) {
  const values = [];
  for (const state of states) walk(state, (value, path) => {
    if (typeof value !== 'string') return;
    const key = String(path.at(-1) || '').toLowerCase(), parent = path.slice(0, -1).join('.').toLowerCase();
    if (!/^(?:channel|scope|recruitmentscope|recruitmenttype|campaigntype|currentchannel|currentscope|selectedchannel|activechannel)$/.test(key)) return;
    if (path.length <= 2 || /current|selected|active|route|page|filter/.test(parent)) values.push(value);
  });
  return values.join(' ');
}

export function parseCnAtsPage(html = '', context = {}) {
  const baseUrl = context.finalUrl || context.requestedUrl || '';
  const vendor = String(context.vendor || 'OTHER').toUpperCase();
  const jsonLd = parseJobPostingJsonLd(html, baseUrl);
  const states = parseStateBlocks(html);
  const activeJobs = stateJobs(states, baseUrl);
  const urls = [...new Set([...extractUrls(html, baseUrl), ...stateUrls(states, baseUrl), ...activeJobs.flatMap((job) => [job.detailUrl, job.applyUrl]).filter(Boolean)])];
  const blocked = /验证码|安全验证|访问过于频繁|captcha|access denied|browser-not-support/i.test(html);
  const expiredCampaign = /招聘已结束|本次招聘已结束|已截止|停止申请|no longer accepting/i.test(html);
  const explicitNoOpenings = /暂无(?:开放)?职位|暂无岗位|没有在招职位|no open(?:ing| position| job)/i.test(html);
  if (!urls.length && !states.length && !jsonLd && !blocked && !expiredCampaign && !explicitNoOpenings) return null;
  const applyUrl = urls.find((url) => /(?:^|\/)apply(?:\.html|\/|\?|$)|application(?:\/|\?|$)/i.test(pathOf(url))) || '';
  const jobDetailUrl = urls.find((url) => /(?:job|position)(?:\/|=)[^/?&#]+/i.test(pathOf(url)) && url !== applyUrl) || '';
  const jobListUrl = urls.find((url) => /(?:^|\/)(?:jobs?|job-list|joblist|positions?)(?:\/|\?|$)/i.test(pathOf(url)) && url !== applyUrl && url !== jobDetailUrl) || '';
  const displayedCompany = firstStateValue(states, ['companyname', 'company_name', 'tenantname', 'brandname', 'organizationname']);
  const legalOrPrivacyEntity = firstStateValue(states, ['legalentity', 'privacyentity', 'legalname', 'copyrightowner']);
  const tenantKey = firstStateValue(states, ['tenantkey', 'tenantid', 'shortname', 'companycode']) || tenantFromUrl(baseUrl, vendor);
  const heading = [...html.matchAll(/<(?:title|h1)\b[^>]*>([\s\S]*?)<\/(?:title|h1)>/gi)].map((match) => match[1].replace(/<[^>]+>/g, ' ')).join(' ');
  const selected = [...html.matchAll(/<[^>]+(?:aria-current=["'](?:page|true)["']|data-selected=["']true["']|class=["'][^"']*\b(?:active|selected|current)\b[^"']*["'])[^>]*>([\s\S]*?)<\/[^>]+>/gi)].map((match) => match[1].replace(/<[^>]+>/g, ' ')).join(' ');
  const text = `${baseUrl} ${heading} ${selected} ${currentPageStateText(states)} ${activeJobs.map((job) => `${job.scope} ${job.recruitmentType} ${job.cohortYear || ''} ${job.title}`).join(' ')}`;
  const recruitmentScope = [];
  if (/campus|校招|校园招聘|应届/i.test(text)) recruitmentScope.push('CAMPUS');
  if (/intern|实习/i.test(text)) recruitmentScope.push('INTERN');
  if (/social|社招|社会招聘/i.test(text)) recruitmentScope.push('SOCIAL');
  if (!recruitmentScope.length) recruitmentScope.push('GENERAL');
  const applicationRequiresLogin = Boolean(applyUrl && /login|signin|登录|returnUrl|redirect/i.test(`${applyUrl} ${html}`));
  const vacancyStatus = blocked ? 'BLOCKED' : expiredCampaign ? 'EXPIRED' : activeJobs.length || jobDetailUrl || jobListUrl || applyUrl ? 'ACTIVE' : explicitNoOpenings || states.some((state) => Array.isArray(state.jobs) && state.jobs.length === 0) ? 'NO_OPENINGS' : 'UNKNOWN';
  const pageRole = applyUrl ? 'APPLY' : jobDetailUrl ? 'JOB_DETAIL' : jobListUrl || activeJobs.length ? 'JOB_LIST' : /campus|校招|校园招聘|intern|实习/i.test(text) ? 'CAMPAIGN' : 'CAREER_HOME';
  const pageState = blocked ? 'BLOCKED_OR_CAPTCHA' : expiredCampaign ? 'EXPIRED_CAMPAIGN' : vacancyStatus === 'NO_OPENINGS' ? 'VERIFIED_NO_OPENINGS' : pageRole === 'APPLY' ? 'APPLY_ACTION' : pageRole === 'JOB_DETAIL' ? 'ACTIVE_JOB_DETAIL' : pageRole === 'JOB_LIST' ? 'ACTIVE_JOB_LIST' : pageRole === 'CAMPAIGN' ? 'VERIFIED_CAMPAIGN' : 'VERIFIED_CAREER_HOME';
  const identityEvidence = [displayedCompany && { code: 'displayed_company', value: displayedCompany }, legalOrPrivacyEntity && { code: 'legal_or_privacy_entity', value: legalOrPrivacyEntity }, tenantKey && { code: 'tenant_key', value: tenantKey }].filter(Boolean);
  return { ...(jsonLd || {}), vendor, tenantKey, displayedCompany, legalOrPrivacyEntity, recruitmentScope: [...new Set(recruitmentScope)], recruitmentChannels: [...new Set(recruitmentScope)], jobListUrl, jobDetailUrl, applyUrl, activeJobs, jobCount: activeJobs.length, applicationRequiresLogin, noOpenings: vacancyStatus === 'NO_OPENINGS', expiredCampaign, blocked, vacancyStatus, pageRole, pageState, identityEvidence };
}
