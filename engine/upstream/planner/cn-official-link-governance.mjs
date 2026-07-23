import { domainToASCII } from 'node:url';
import { classifyCnRoleFamily } from './cn-role-taxonomy.mjs';
import { unwrapNowcoderJump } from './official-links.mjs';

const TRACKING = new Set(['utm_source','utm_medium','utm_campaign','utm_term','utm_content','scene','click_id','from','spread','channeltoken']);
const MULTI_SUFFIXES = new Set(['com.cn','net.cn','org.cn','gov.cn','edu.cn','com.hk','edu.hk','org.hk','co.uk','com.au','co.jp']);
const DENYLIST = new Set(['gaoxiaojob.com','wondercv.com','linkedin.com','jobui.com','qiuzhifangzhou.com','bosszhipin.com','bendibao.com','91jzx.cn','fandow.com','pzw520.com','nowcoder.com','gankinterview.cn','gankinterview.com','langlangwangshen.com','niuqizp.com','niuqizhipin.com','yingjiesheng.com','shixiseng.com','liepin.com','zhipin.com','51job.com','lagou.com','zhaopin.com','ncss.cn','91wllm.cn','91wllm.com']);
const MEDIA = new Set(['thepaper.cn','36kr.com','huxiu.com','sohu.com','sina.com.cn','163.com','qq.com']);
const ATS = new Map([
  ['mokahr.com','moka'], ['zhiye.com','beisen_zhiye'], ['hotjob.cn','hotjob'], ['jobs.feishu.cn','feishu_jobs'], ['myworkdayjobs.com','workday'], ['jobs2web.com','jobs2web'], ['greenhouse.io','greenhouse'], ['smartrecruiters.com','smartrecruiters'], ['tupu360.com','tupu360'], ['moseeker.com','moseeker'], ['zhaopin.com','zhaopin_campaign'], ['73cn.cn','73cn'], ['jobs.lever.co','lever'], ['jobs.ashbyhq.com','ashby'],
]);
const CAREER_PATH = /(?:^|\/)(?:career|careers|job|jobs|join|join-us|recruit|recruitment|campus|talent|positions?|apply)(?:\/|$|[?#])|校园招聘|加入我们|人才招聘|社会招聘/i;
const ANNOUNCEMENT = /(?:20\d{2}届|校招|校园招聘|秋招|春招|提前批|暑期实习|实习生|补录|招聘公告|招聘启事)/i;
const APPLY_PATH = /(?:apply|application|jobid|positionid|projectid|tenantid|jobs?\/[^/]+|position\/[^/]+|zwcx|job-list|joblist|positions?)(?:\/|$|[?])/i;
const STATIC_ASSET_RE = /\.(?:css|js|mjs|cjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|otf|eot|mp4|mp3|pdf|zip|json|xml|txt|wasm)(?:$|[?#])/i;

export function isStaticAsset(value = '') { return STATIC_ASSET_RE.test(String(value || '')); }

export const DEFAULT_REGISTRIES = Object.freeze({ version: 1, companyDomainRegistry: [], atsTenantRegistry: [], companyWechatRegistry: [], domainDenylist: [...DENYLIST], domainTrustedRepostRegistry: [], urlFunctionalParameterRegistry: {}, audit: [] });

function hostMatches(host, suffix) { return host === suffix || host.endsWith(`.${suffix}`); }
function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function aliases(company = '') { const name = clean(company).toLowerCase(); return [...new Set([name, name.replace(/(股份有限公司|有限责任公司|有限公司|集团|公司)$/g, ''), name.replace(/[（）()\s·•]/g, '')].filter((x) => x.length >= 2))]; }

function htmlText(value = '') { return clean(String(value).replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).toLowerCase(); }
function fragment(html, pattern) { return html.match(pattern)?.[1] || ''; }
function containsCompany(value, company) { const text = htmlText(value); return aliases(company).some((name) => text.includes(name)); }

export function assessCandidatePageIdentity(company = '', html = '', finalUrl = '') {
  const identitySignals = [];
  const title = fragment(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogSiteName = fragment(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
    || fragment(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
  const jsonLdNames = [...html.matchAll(/["'](?:name|legalName)["']\s*:\s*["']([^"']+)["']/gi)].map((match) => match[1]).join(' ');
  const footer = [...html.matchAll(/<footer\b[^>]*>([\s\S]*?)<\/footer>/gi)].map((match) => match[1]).join(' ');
  const brandedNavigation = [...html.matchAll(/<(?:nav|header)[^>]*>([\s\S]*?)<\/(?:nav|header)>/gi)].map((match) => match[1]).join(' ');
  if (containsCompany(title, company)) identitySignals.push('title_company_match');
  if (containsCompany(ogSiteName, company)) identitySignals.push('og_site_name_match');
  if (containsCompany(jsonLdNames, company)) identitySignals.push('jsonld_organization_match');
  if (containsCompany(footer, company)) identitySignals.push('footer_company_match');
  if (containsCompany(brandedNavigation, company)) identitySignals.push('navigation_brand_match');
  const recruitmentSurface = `${title} ${ogSiteName} ${brandedNavigation} ${finalUrl}`;
  const recruitmentSignal = /招聘|校招|校园招聘|社会招聘|实习|职位|加入我们|人才招聘|career|jobs?|join us|recruit|talent/i.test(htmlText(recruitmentSurface));
  return { passed: identitySignals.length >= 2 && recruitmentSignal, identitySignals, recruitmentSignal };
}

// A dedicated ATS tenant is a separate identity boundary from the page markup.
// For example, `company.zhiye.com` plus an exact company title and a recruitment
// surface is sufficient evidence; requiring a second HTML signal would reject
// legitimate ATS pages that omit footers, JSON-LD, or og:site_name.
export function assessDedicatedAtsTenantIdentity(company = '', html = '', finalUrl = '', tenantBound = false) {
  const identity = assessCandidatePageIdentity(company, html, finalUrl);
  const titleMatched = identity.identitySignals.includes('title_company_match');
  return {
    ...identity,
    dedicatedTenantBound: tenantBound,
    passed: identity.passed || Boolean(tenantBound && titleMatched && identity.recruitmentSignal),
    verificationBasis: identity.passed
      ? 'multiple_page_identity_signals'
      : tenantBound && titleMatched && identity.recruitmentSignal
        ? 'dedicated_ats_tenant_title_and_recruitment'
        : 'insufficient_identity_evidence',
  };
}

export function isCompanySpecificAtsHost(value = '') {
  try {
    const host = new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '');
    const root = registrableDomain(host);
    const prefix = host.slice(0, -(root.length + 1)).split('.').filter(Boolean)[0] || '';
    return Boolean(prefix && !['www', 'app', 'wecruit', 'jobs', 'career', 'careers', 'recruit'].includes(prefix));
  } catch { return false; }
}

export function registrableDomain(value = '') {
  const host = String(value || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/:[0-9]+(?=\/|$)/, '').replace(/\/.*$/, '').replace(/\.$/, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const suffix = parts.slice(-2).join('.');
  return MULTI_SUFFIXES.has(suffix) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

export function canonicalizeRecruitmentUrl(value = '') {
  const originalUrl = clean(value); const unwrapped = unwrapNowcoderJump(originalUrl);
  try {
    const url = new URL(unwrapped);
    if (!/^https?:$/.test(url.protocol)) return { originalUrl, canonicalUrl: '', finalUrl: '', redirectChain: [], reason: 'invalid_scheme' };
    url.protocol = url.protocol.toLowerCase(); url.hostname = domainToASCII(url.hostname.toLowerCase());
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    for (const key of [...url.searchParams.keys()]) if (TRACKING.has(key.toLowerCase())) url.searchParams.delete(key);
    if (!/\/(?:#|index\.html$)/i.test(url.pathname)) url.hash = '';
    if (isStaticAsset(url.pathname)) return { originalUrl, canonicalUrl: '', finalUrl: '', redirectChain: [], reason: 'static_asset' };
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    return { originalUrl, canonicalUrl: url.href, finalUrl: url.href, redirectChain: [], reason: '' };
  } catch { return { originalUrl, canonicalUrl: '', finalUrl: '', redirectChain: [], reason: 'invalid_url' }; }
}

function registryDomainMatch(company, host, registry) {
  const entry = (registry.companyDomainRegistry || []).find((item) => item.active !== false && aliases(item.companyId || item.company || '').some((name) => aliases(company).includes(name)) && hostMatches(host, String(item.domain || '').toLowerCase().replace(/^www\./, '')));
  return entry || null;
}
export function wechatMappingKey(value = '') {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const biz = url.searchParams.get('__biz') || url.searchParams.get('biz') || '';
    if (biz) return `${host}|${biz}`;
    const article = url.pathname.replace(/\/+/g, '/').replace(/^\/|\/$/g, '').replace(/^s\//, '');
    return `${host}|article:${article || 'unknown'}`;
  } catch { return 'mp.weixin.qq.com|invalid'; }
}
function tenantMatch(company, host, path, registry) {
  return (registry.atsTenantRegistry || []).find((item) => (
    item.active !== false
    && aliases(item.companyId || item.company || item.verifiedCompanyName || '').some((name) => aliases(company).includes(name))
    && (hostMatches(host, String(item.hostPattern || '').toLowerCase()) || hostMatches(host, String(item.atsPlatform || '').toLowerCase()))
    && (!item.tenantKey || host.includes(String(item.tenantKey).toLowerCase()) || path.includes(String(item.tenantKey).toLowerCase()))
  )) || null;
}
function wechatMatch(company, url, registry) {
  const biz = url.searchParams.get('__biz') || '';
  return (registry.companyWechatRegistry || []).find((item) => (
    item.accountType
    && /company_(official|recruitment)|subsidiary_official/.test(item.accountType)
    && aliases(item.companyId || item.company || item.verifiedEntity || '').some((name) => aliases(company).includes(name))
    && ((biz && item.bizId === biz) || (!biz && item.accountName && aliases(item.accountName).some((name) => aliases(company).includes(name))))
  )) || null;
}
function urlRole(url, sourceType, companyDomain) {
  const text = `${url.pathname}${url.search}`;
  if (sourceType === 'wechat') return 'official_wechat_announcement';
  if (sourceType === 'university' || sourceType === 'government') return 'trusted_repost';
  if (sourceType === 'aggregator') return 'aggregator_source';
  if (sourceType === 'media') return 'media_article';
  if (APPLY_PATH.test(text)) return 'application_form';
  if (ANNOUNCEMENT.test(decodeURIComponent(`${url.pathname}${url.search}`))) return 'campaign_announcement';
  if (CAREER_PATH.test(`${url.hostname}${text}`)) return /(?:jobs?|positions?)(?:\/|$|[?#])/i.test(text) ? 'job_list' : 'company_career_home';
  return companyDomain ? 'company_career_home' : 'unknown';
}

export function resolvePromotedCandidateMappings(registries = DEFAULT_REGISTRIES) {
  const deny = new Set((registries.domainDenylist || []).map((item) => String(item).toLowerCase()));
  const promotedAts = (registries.atsTenantCandidates || [])
    .filter((item) => ['confirmed', 'verified', 'approved'].includes(String(item.status || '').toLowerCase()) && item.companyId && item.mappingKey && !deny.has(String(item.mappingKey).toLowerCase()))
    .map((item) => ({ companyId: item.companyId, atsPlatform: item.platform || '', hostPattern: item.mappingKey, tenantKey: String(item.mappingKey).split('.')[0], verifiedCompanyName: item.companyId, evidenceUrl: item.sampleUrl || '', verificationMethod: item.verificationMethod || 'confirmed_candidate_promotion', verifiedAt: item.verifiedAt || null, active: true }));
  const promotedDomains = (registries.companyDomainCandidates || [])
    .filter((item) => ['confirmed', 'verified', 'approved'].includes(String(item.status || '').toLowerCase()) && item.companyId && item.mappingKey && !deny.has(String(item.mappingKey).toLowerCase()))
    .map((item) => ({ companyId: item.companyId, domain: item.mappingKey, domainType: 'career_candidate', verificationMethod: item.verificationMethod || 'confirmed_candidate_promotion', evidenceUrl: item.sampleUrl || '', verifiedAt: item.verifiedAt || null, active: true }));
  return { promotedDomains, promotedAts };
}

export function applyResolutionRegistries(registries = DEFAULT_REGISTRIES) {
  const { promotedDomains, promotedAts } = resolvePromotedCandidateMappings(registries);
  const seenAts = new Set((registries.atsTenantRegistry || []).map((item) => `${item.companyId}|${item.hostPattern}`));
  const seenDomains = new Set((registries.companyDomainRegistry || []).map((item) => `${item.companyId}|${item.domain}`));
  return {
    ...registries,
    companyDomainRegistry: [...(registries.companyDomainRegistry || []), ...promotedDomains.filter((item) => !seenDomains.has(`${item.companyId}|${item.domain}`))],
    atsTenantRegistry: [...(registries.atsTenantRegistry || []), ...promotedAts.filter((item) => !seenAts.has(`${item.companyId}|${item.hostPattern}`))],
    autoPromotedForApplyResolution: { ats: promotedAts.length, domains: promotedDomains.length },
  };
}

export function quarantineLegacyAutoPromotedMappings(registries = DEFAULT_REGISTRIES) {
  const legacyMethod = 'candidate_source_auto_apply_resolution';
  const legacyDomains = (registries.companyDomainRegistry || []).filter((item) => item.verificationMethod === legacyMethod);
  const legacyAts = (registries.atsTenantRegistry || []).filter((item) => item.verificationMethod === legacyMethod);
  const domainCandidates = [...(registries.companyDomainCandidates || [])];
  const atsCandidates = [...(registries.atsTenantCandidates || [])];
  const domainKeys = new Set(domainCandidates.map((item) => `${item.companyId}|${item.mappingKey}`));
  const atsKeys = new Set(atsCandidates.map((item) => `${item.companyId}|${item.mappingKey}`));
  for (const item of legacyDomains) {
    const key = `${item.companyId}|${item.domain}`;
    if (!domainKeys.has(key)) domainCandidates.push({ companyId: item.companyId, mappingKey: item.domain, kind: 'domain', sampleUrl: item.evidenceUrl || '', status: 'candidate', quarantineReason: 'legacy_auto_promotion' });
  }
  for (const item of legacyAts) {
    const key = `${item.companyId}|${item.hostPattern}`;
    if (!atsKeys.has(key)) atsCandidates.push({ companyId: item.companyId, mappingKey: item.hostPattern, platform: item.atsPlatform || '', kind: 'ats', sampleUrl: item.evidenceUrl || '', status: 'candidate', quarantineReason: 'legacy_auto_promotion' });
  }
  return {
    registries: {
      ...registries,
      companyDomainRegistry: (registries.companyDomainRegistry || []).filter((item) => item.verificationMethod !== legacyMethod),
      atsTenantRegistry: (registries.atsTenantRegistry || []).filter((item) => item.verificationMethod !== legacyMethod),
      companyDomainCandidates: domainCandidates,
      atsTenantCandidates: atsCandidates,
    },
    summary: { quarantinedDomains: legacyDomains.length, quarantinedAts: legacyAts.length },
  };
}

export function classifyGovernedRecruitmentUrl({ company = '', url = '', registries = DEFAULT_REGISTRIES } = {}) {
  const normalized = canonicalizeRecruitmentUrl(url);
  if (!normalized.canonicalUrl) return { ...normalized, sourceType: 'unknown', urlRole: 'unknown', decision: 'missing_or_dead', reasons: [normalized.reason || 'missing_url'], ats: '' };
  const parsed = new URL(normalized.canonicalUrl); const host = parsed.hostname.toLowerCase().replace(/^www\./, ''); const root = registrableDomain(host);
  const deny = new Set([...(registries.domainDenylist || []), ...DENYLIST]);
  let sourceType = 'unknown', decision = 'unknown', reasons = [], ats = '', domainEntry = null, tenantEntry = null, wechatEntry = null;
  const detectedAts = [...ATS.entries()].find(([suffix]) => hostMatches(host, suffix))?.[1] || '';
  const confirmedTenant = detectedAts ? tenantMatch(company, host, `${parsed.pathname}${parsed.search}`, registries) : null;
  if (host.endsWith('.edu.cn') || host.endsWith('.edu.hk') || /91wllm\.com$/.test(host)) { sourceType = 'university'; decision = 'university_repost'; reasons.push('高校就业平台'); }
  else if (root.endsWith('.gov.cn')) { sourceType = 'government'; decision = 'government_repost'; reasons.push('政府转载'); }
  else if (deny.has(root) && !confirmedTenant) { sourceType = 'aggregator'; decision = 'aggregator_source'; reasons.push('域名拒绝名单'); }
  // mp.weixin.qq.com is hosted under qq.com, so it must be resolved before the
  // generic QQ media rule.
  else if (host === 'mp.weixin.qq.com') { sourceType = 'wechat'; wechatEntry = wechatMatch(company, parsed, registries); decision = wechatEntry ? 'official_wechat_announcement' : 'wechat_identity_unproven'; reasons.push(wechatEntry ? '公众号账号映射命中' : '公众号主体未映射'); }
  else if (MEDIA.has(root)) { sourceType = 'media'; decision = 'media_article'; reasons.push('媒体域名'); }
  else {
    ats = detectedAts;
    if (ats) { sourceType = 'delegated_ats'; tenantEntry = confirmedTenant || tenantMatch(company, host, `${parsed.pathname}${parsed.search}`, registries); decision = tenantEntry ? 'ats_tenant_confirmed' : 'ats_platform_recognized'; reasons.push(tenantEntry ? 'ATS租户映射命中' : 'ATS平台已识别，租户未映射'); }
    else { domainEntry = registryDomainMatch(company, host, registries); if (domainEntry) { sourceType = 'corporate_domain'; decision = 'corporate_domain_confirmed'; reasons.push('企业主域名注册表命中'); } else reasons.push('企业主域名未登记'); }
  }
  const role = urlRole(parsed, sourceType, Boolean(domainEntry || tenantEntry));
  return { ...normalized, host, registrableDomain: root, sourceType, urlRole: role, decision, reasons, ats, domainRegistryEntry: domainEntry || null, atsTenantEntry: tenantEntry || null, wechatRegistryEntry: wechatEntry || null };
}

function rolePriority(link) { return ({ application_form: 6, job_list: 5, campaign_announcement: 4, company_career_home: 3, official_wechat_announcement: 2, trusted_repost: 1 })[link.urlRole] || 0; }

function validatedPlatformFallback(record = {}) {
  if (record.platformIdentityConfirmed !== true || !record.platformJobListUrl) return null;
  const normalized = canonicalizeRecruitmentUrl(record.platformJobListUrl);
  if (!normalized.canonicalUrl) return null;
  const parsed = new URL(normalized.canonicalUrl);
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();
  const platformName = hostMatches(host, 'liepin.com') && (/^\/company-jobs\/\d+$/.test(path) || /^\/company\/\d+$/.test(path)) ? '猎聘'
    : (hostMatches(host, 'zhipin.com') || hostMatches(host, 'bosszhipin.com')) && (/^\/gongsi\/job\/[a-z0-9]+\.html$/.test(path) || /^\/companys?\/[a-z0-9]+\/?(?:jobs?)?$/.test(path)) ? 'BOSS直聘'
      : hostMatches(host, 'zhaopin.com') && (/\/company\/.+\/jobs?$/.test(path) || /\/companydetail\/.+/.test(path)) ? '智联招聘'
        : hostMatches(host, '51job.com') && /\/company\/.+/.test(path) ? '前程无忧'
          : hostMatches(host, 'lagou.com') && (/\/gongsi\/j\d+\.html$/.test(path) || /\/gongsi\/\d+\.html$/.test(path)) ? '拉勾'
            : '';
  if (!platformName) return null;
  return {
    url: normalized.finalUrl,
    platformName: record.platformName || platformName,
    platformCompanyName: clean(record.platformCompanyName || record.company),
    platformIdentityConfirmed: true,
  };
}

export function buildRecruitmentLinks(record = {}, registries = DEFAULT_REGISTRIES) {
  const candidates = [
    record.finalApplyUrl, record.applyUrl, record.announcementUrl, record.detailUrl, record.officialUrl, record.primaryUrl,
    record.platformJobListUrl,
    ...(record.sourceLinks || []).map((item) => item.url),
    ...(record.recruitmentLinks?.assessments || []).flatMap((item) => [item.originalUrl, item.canonicalUrl, item.finalUrl]),
    ...(record.resolvedLinks?.sourceDocumentUrls || []),
  ].filter(Boolean);
  let assessed = [...new Map(candidates.map((url) => { const item = classifyGovernedRecruitmentUrl({ company: record.company, url, registries }); return [item.canonicalUrl || item.originalUrl, item]; })).values()];

  // Fuzzy fallback:仅当 records 没有 company_career_home / apply / list 候选时,才从 registry 找 company 的主域
  // 注意:fuzzy 推断是 low confidence,只走 candidateOfficialUrl 路径,不直接当 career_home(避免 metrics 过度乐观)
  // 区分 fuzzy 推断:URL 的 host 在 record.sourceLinks 里 → 真 career_home;不在 → fuzzy 推断
  let fuzzyCandidate = null;
  let fuzzyIsFresh = false;
  const hasCareerIntent = assessed.some((item) => ['company_career_home', 'application_form', 'job_list'].includes(item.urlRole));
  if (!hasCareerIntent && registries.companyDomainRegistry?.length && record.company) {
    const aliases = (name = '') => [name, name.replace(/(集团股份有限公司|集团股份|集团|股份有限公司|股份|有限责任公司|有限公司|总行|分行|支行|控股|科技|公司|银行|（中国）有限公司|（中国）|中国|分部|总部)/g, '')].filter(Boolean);
    const companyAliases = new Set(aliases(record.company).map((a) => a.toLowerCase()));
    for (const entry of registries.companyDomainRegistry) {
      if (entry.active === false) continue;
      const entryAliases = new Set(aliases(entry.companyId || '').map((a) => a.toLowerCase()));
      const matched = [...companyAliases].some((a) => a && entryAliases.has(a));
      if (matched) {
        for (const candidateUrl of [`https://careers.${entry.domain}/`, `https://${entry.domain}/careers`, `https://${entry.domain}/`]) {
          const inferred = classifyGovernedRecruitmentUrl({ company: record.company, url: candidateUrl, registries });
          if (inferred.decision === 'corporate_domain_confirmed' && !assessed.find((a) => a.canonicalUrl === inferred.canonicalUrl)) {
            // 检查 host 是否在 sourceLinks 里(真 career_home)还是只在 registry(模糊推断)
            let hostInSources = false;
            try {
              const candidateHost = new URL(candidateUrl).hostname.toLowerCase().replace(/^www\./, '');
              for (const src of record.sourceLinks || []) {
                try {
                  const srcHost = new URL(src.url || '').hostname.toLowerCase().replace(/^www\./, '');
                  if (srcHost === candidateHost || srcHost.endsWith(`.${candidateHost}`) || candidateHost.endsWith(`.${srcHost}`)) {
                    hostInSources = true;
                    break;
                  }
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
            if (hostInSources) {
              // 真 career_home,从 sourceLinks 来的,直接进 assessed
              assessed = [...assessed, inferred];
            } else {
              // Fuzzy 推断,只走 candidate
              fuzzyCandidate = inferred;
              fuzzyIsFresh = true;
            }
            break;
          }
        }
        if (fuzzyCandidate || fuzzyIsFresh) break;
      }
    }
  }

  const usable = assessed.filter((item) => ['corporate_domain_confirmed','ats_tenant_confirmed','official_wechat_announcement'].includes(item.decision));
  const apply = usable.filter((item) => item.urlRole === 'application_form').sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  const jobList = usable.filter((item) => item.urlRole === 'job_list').sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  const announcement = usable.filter((item) => ['campaign_announcement','official_wechat_announcement'].includes(item.urlRole)).sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  const career = usable.filter((item) => item.urlRole === 'company_career_home').sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  const primary = apply || jobList || announcement || career || null;
  const sourceDocumentUrls = assessed.filter((item) => ['university_repost','government_repost','aggregator_source','media_article','wechat_identity_unproven','ats_platform_recognized','unknown'].includes(item.decision)).map((item) => item.finalUrl).filter(Boolean);
  const candidate = assessed.filter((item) => ['ats_platform_recognized','wechat_identity_unproven'].includes(item.decision) || (item.decision === 'unknown' && ['company_career_home','job_list','application_form','campaign_announcement'].includes(item.urlRole))).sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  const candidateApply = assessed.filter((item) => ['ats_platform_recognized','unknown'].includes(item.decision) && ['application_form','job_list'].includes(item.urlRole)).sort((a, b) => rolePriority(b) - rolePriority(a))[0] || null;
  // Fuzzy fallback candidate:把 registry 推断的 low confidence URL 注入 candidate(不影响 career / apply)
  const fuzzyAsCandidate = fuzzyCandidate ? { ...fuzzyCandidate, _lowConfidence: true } : null;
  const effectiveCandidate = (candidate || fuzzyAsCandidate) || null;
  const platformFallback = validatedPlatformFallback(record);
  const platformAsBest = platformFallback ? { finalUrl: platformFallback.url, decision: 'job_board_company_list', urlRole: 'job_board_company_list', sourceType: 'job_board_fallback' } : null;
  const best = primary || effectiveCandidate || platformAsBest || assessed.find((item) => item.decision === 'government_repost') || assessed.find((item) => item.decision === 'university_repost') || assessed.find((item) => item.decision === 'aggregator_source') || assessed.find((item) => item.decision === 'media_article') || null;
  const label = primary?.urlRole === 'application_form' || primary?.urlRole === 'job_list' ? '立即投递' : primary?.urlRole === 'campaign_announcement' ? '官方招聘公告' : primary?.urlRole === 'company_career_home' ? '企业招聘官网' : primary?.urlRole === 'official_wechat_announcement' ? '官方公众号公告' : (candidate && candidate.finalUrl && candidate.finalUrl === best?.finalUrl) ? (candidate.sourceType === 'wechat' ? '公众号招聘信息' : '官网候选') : best?.decision === 'job_board_company_list' ? '查看平台岗位' : best?.decision === 'government_repost' ? '政府转载' : best?.decision === 'university_repost' ? '高校转载' : best?.decision === 'aggregator_source' ? '信息来源' : best?.decision === 'media_article' ? '相关报道' : null;
  const campaignLinks = assessed.map((item) => ({ linkId: item.canonicalUrl || item.originalUrl, originalUrl: item.originalUrl, canonicalUrl: item.canonicalUrl, finalUrl: item.finalUrl || null, linkRole: item.urlRole, identityStatus: item.decision === 'corporate_domain_confirmed' ? 'verified_official' : item.decision === 'ats_tenant_confirmed' ? 'verified_ats' : item.decision === 'official_wechat_announcement' ? 'verified_wechat' : ['ats_platform_recognized','wechat_identity_unproven'].includes(item.decision) || (item.decision === 'unknown' && item.urlRole !== 'unknown') ? 'high_confidence_candidate' : ['university_repost','government_repost'].includes(item.decision) ? 'trusted_source' : ['aggregator_source','media_article'].includes(item.decision) ? 'rejected' : 'unverified', sourceType: item.sourceType === 'delegated_ats' ? 'ats' : item.sourceType, companyIdentityConfirmed: ['corporate_domain_confirmed','ats_tenant_confirmed','official_wechat_announcement'].includes(item.decision), campaignConfirmed: false, applicationActive: null, mappingType: item.sourceType === 'corporate_domain' ? 'company_domain' : item.sourceType === 'delegated_ats' ? 'ats_tenant' : item.sourceType === 'wechat' ? 'wechat_account' : 'none', mappingKey: item.sourceType === 'wechat' ? wechatMappingKey(item.canonicalUrl) : ['corporate_domain','delegated_ats'].includes(item.sourceType) ? item.host : null, evidence: item.reasons || [], rejectionReasons: ['university_repost','government_repost','aggregator_source','media_article'].includes(item.decision) ? item.reasons || [] : [] }));
  return { enforced: true, companyCareerHomeUrl: career?.finalUrl || null, campaignLandingUrl: announcement?.finalUrl || null, campaignAnnouncementUrl: announcement?.finalUrl || null, jobListUrl: jobList?.finalUrl || null, jobDetailUrl: null, applyUrl: apply?.finalUrl || null, platformJobListUrl: platformFallback?.url || null, platformName: platformFallback?.platformName || '', platformCompanyName: platformFallback?.platformCompanyName || '', platformIdentityConfirmed: platformFallback?.platformIdentityConfirmed === true, entrySourceTier: primary ? 'OFFICIAL' : effectiveCandidate ? 'OFFICIAL_CANDIDATE' : platformFallback ? 'JOB_BOARD_FALLBACK' : '', candidateOfficialUrl: effectiveCandidate?.finalUrl || null, candidateApplyUrl: candidateApply?.finalUrl || null, bestAvailableUrl: best?.finalUrl || null, bestAvailableUrlLabel: label, sourceDocumentUrl: sourceDocumentUrls[0] || null, sourceDocumentUrls, originalUrl: primary?.originalUrl || best?.originalUrl || null, canonicalUrl: primary?.canonicalUrl || best?.canonicalUrl || null, finalUrl: primary?.finalUrl || best?.finalUrl || null, redirectChain: primary?.redirectChain || best?.redirectChain || [], urlRole: primary?.urlRole || best?.urlRole || 'unknown', sourceType: primary?.sourceType || best?.sourceType || 'unknown', assessments: assessed, campaignLinks };
}

function campaignSources(record, links) {
  const sourceName = clean(record.source) || 'other';
  const known = new Map([
    ['nowcoder', 'nowcoder'], ['gank', 'gank'], ['浪浪', 'langlang'], ['langlang', 'langlang'], ['牛企', 'niuqizp'],
    ['高校', 'university'], ['大学', 'university'], ['政府', 'government'], ['官方', 'company_official'], ['微信', 'wechat'],
  ]);
  const mappedName = [...known.entries()].find(([needle]) => sourceName.toLowerCase().includes(needle.toLowerCase()))?.[1] || 'other';
  return (links.assessments || []).map((item) => ({
    campaignId: record.projectId || record.id || '', sourceName: item.sourceType === 'corporate_domain' ? 'company_official' : item.sourceType === 'wechat' ? 'wechat' : item.sourceType === 'university' ? 'university' : item.sourceType === 'government' ? 'government' : item.sourceType === 'aggregator' ? mappedName : mappedName,
    sourceRole: ['corporate_domain_confirmed', 'ats_tenant_confirmed'].includes(item.decision) ? 'official_evidence' : item.urlRole === 'application_form' ? 'application' : 'discovery',
    sourceUrl: item.finalUrl || item.originalUrl || '', firstSeenAt: record.firstSeenAt || null,
  }));
}

export function classifyRoleCategories(record = {}) {
  const text = `${record.title || ''} ${(record.roleCategories || []).join(' ')} ${record.description || ''}`;
  const families = [
    ['产品', /产品经理|产品助理|产品策划/i], ['技术研发', /软件|开发|前端|后端|测试|运维|java|python|c\+\+/i], ['算法', /算法|机器学习|深度学习|大模型|nlp|视觉/i], ['数据', /数据分析|数据科学|bi\b/i], ['设计', /设计|ui|ux|交互|视觉/i], ['运营', /运营|用户增长/i], ['市场', /市场|营销|品牌|广告/i], ['销售', /销售|商务|bd/i], ['金融', /金融|银行|证券|基金|保险|风控|审计|财务/i], ['咨询', /咨询|行业研究/i], ['供应链', /供应链|采购|物流/i], ['制造工程', /制造|工艺|机械|电气/i], ['职能', /人力|行政|法务|hr/i], ['法律', /律师|法务|合规/i], ['媒体内容', /内容|编辑|媒体|直播/i], ['教育', /教师|教育|培训/i], ['研究', /研究员|科研|博士后/i],
  ].filter(([, regex]) => regex.test(text)).map(([label]) => label);
  return families.length ? families : [classifyCnRoleFamily(record) === '其他' ? '其他' : classifyCnRoleFamily(record)];
}

export function cleanCompanyName(value = '') { return clean(value).replace(/(?:20\d{2}|\d{2})届(?:校招|秋招|春招|实习)?|暑期实习|日常实习|校园招聘|校招|秋招|春招|提前批|补录|预告|剩余岗位/gi, '').replace(/\s*(?:机械类|电气类|岗位)$/g, '').trim(); }
export function graduationInfo(record = {}) { const raw = clean(record.graduationYearRaw || `${record.title || ''} ${record.batchName || ''} ${record.description || ''}`); const years = [...new Set([...(record.graduationYears || []), ...[...raw.matchAll(/20\d{2}/g)].map((item) => Number(item[0]))].map(Number).filter((year) => year >= 2020 && year <= 2035))].sort(); return { graduationYears: years, graduationYearRaw: raw, cohortYear: years.length === 1 ? years[0] : null, audienceType: /在校生|所有学生/.test(raw) ? 'current_students' : years.length ? 'graduation_years' : 'unknown' }; }

export function governRecruitmentRecord(record = {}, registries = DEFAULT_REGISTRIES, now = Date.now()) {
  const links = buildRecruitmentLinks(record, registries); const graduation = graduationInfo(record); const stale = Boolean(record.expiresAt && record.firstSeenAt && Number(record.expiresAt) < Number(record.firstSeenAt));
  const identity = links.assessments.find((item) => ['corporate_domain_confirmed','ats_tenant_confirmed','official_wechat_announcement'].includes(item.decision));
  const reachable = identity ? 'unknown' : 'unknown'; const campaignConfirmed = 'unknown'; const applicationActive = stale ? 'no' : 'unknown';
  const activeVerified = reachable === 'yes' && campaignConfirmed === 'yes' && applicationActive === 'yes' && identity;
  return { ...record, companyRawName: record.companyRawName || record.company || '', companyCleanName: cleanCompanyName(record.company || ''), company: cleanCompanyName(record.company || '') || record.company, ...graduation, roleCategories: classifyRoleCategories(record), recruitmentLinks: links, resolvedLinks: { companyCareerHomeUrl: links.companyCareerHomeUrl, campaignLandingUrl: links.campaignLandingUrl, jobListUrl: links.jobListUrl, jobDetailUrl: links.jobDetailUrl, applyUrl: links.applyUrl, platformJobListUrl: links.platformJobListUrl, platformName: links.platformName, platformCompanyName: links.platformCompanyName, platformIdentityConfirmed: links.platformIdentityConfirmed, entrySourceTier: links.entrySourceTier, candidateOfficialUrl: links.candidateOfficialUrl, candidateApplyUrl: links.candidateApplyUrl, bestAvailableUrl: links.bestAvailableUrl, bestAvailableUrlLabel: links.bestAvailableUrlLabel, sourceDocumentUrls: links.sourceDocumentUrls }, officialUrl: links.applyUrl || links.jobListUrl || links.campaignAnnouncementUrl || links.companyCareerHomeUrl || '', finalApplyUrl: links.applyUrl || '', announcementUrl: links.campaignAnnouncementUrl || '', detailUrl: links.jobDetailUrl || links.campaignAnnouncementUrl || '', primaryUrl: links.applyUrl || links.jobListUrl || links.campaignAnnouncementUrl || links.companyCareerHomeUrl || '', ats: identity?.ats || links.assessments.find((item) => item.ats)?.ats || '', officialVerified: Boolean(activeVerified), verification: { reachable, officialIdentityConfirmed: identity ? 'yes' : 'no', campaignConfirmed, applicationActive, verificationMethod: identity?.sourceType === 'corporate_domain' ? 'company_domain_registry' : identity?.sourceType === 'delegated_ats' ? 'ats_tenant_registry' : identity?.sourceType === 'wechat' ? 'wechat_account_registry' : 'none', verificationEvidence: identity ? [identity.canonicalUrl] : [], verifiedAt: null }, verificationStatus: activeVerified ? 'active_verified' : identity ? 'official_source_found' : 'unverified', verificationState: activeVerified ? 'VERIFIED' : 'UNVERIFIED', verificationReason: stale ? '截止日期早于首次发现，已降级为过期' : identity ? '官方主体已映射，待批次与投递状态核验' : links.assessments.map((item) => item.decision).join(' / ') || 'missing_or_dead', staleOrExpired: stale, deadlineType: record.deadlineType || (record.expiresAt ? 'exact' : 'unknown'), status: stale ? 'expired' : '待官网验证', campaignSources: campaignSources(record, links), officialLinkGovernedAt: now };
}

export function auditOfficialLinks(records = [], registries = DEFAULT_REGISTRIES, now = Date.now()) {
  const governed = records.map((record) => governRecruitmentRecord(record, registries, now)); const n = (fn) => governed.filter(fn).length;
  const projectIds = new Set(governed.map((record) => record.projectId || `${record.company}|${record.cohortYear || 'unknown'}|${record.recruitmentType || record.scope || 'unknown'}`));
  const allLinks = governed.flatMap((record) => record.recruitmentLinks.assessments || []);
  const categories = (name) => allLinks.filter((item) => item.decision === name).length;
  const duplicateMap = new Map(); for (const record of governed) for (const link of record.recruitmentLinks.assessments || []) if (link.canonicalUrl) duplicateMap.set(link.canonicalUrl, [...(duplicateMap.get(link.canonicalUrl) || []), record.id]);
  const duplicateUrlGroups = [...duplicateMap.entries()].filter(([, ids]) => ids.length > 1).map(([url, ids]) => ({ url, recordIds: ids, count: ids.length }));
  const reviewReasons = governed.flatMap((record) => record.recruitmentLinks.assessments.filter((item) => !['corporate_domain_confirmed','ats_tenant_confirmed','official_wechat_announcement'].includes(item.decision)).map((item) => item.decision));
  const reviewObjectMap = new Map();
  for (const link of allLinks.filter((item) => ['unknown', 'ats_platform_recognized', 'wechat_identity_unproven'].includes(item.decision))) {
    const kind = link.decision === 'ats_platform_recognized' ? 'ats_tenant' : link.decision === 'wechat_identity_unproven' ? 'wechat_account' : 'company_domain';
    const key = kind === 'wechat_account' ? wechatMappingKey(link.canonicalUrl) : link.host;
    const item = reviewObjectMap.get(`${kind}|${key}`) || { kind, key, reason: link.decision, affectedRecords: 0 };
    item.affectedRecords += 1; reviewObjectMap.set(`${kind}|${key}`, item);
  }
  const manualReviewProjectIds = new Set(governed.filter((record) => record.verificationStatus === 'unverified').map((record) => record.projectId || record.id));
  return { generatedAt: now, totalRecords: governed.length, totalProjects: projectIds.size, metrics: { missingLinks: n((r) => !r.recruitmentLinks.finalUrl), companyCareerHomes: n((r) => Boolean(r.recruitmentLinks.companyCareerHomeUrl)), applyUrls: n((r) => Boolean(r.recruitmentLinks.applyUrl)), announcements: n((r) => Boolean(r.recruitmentLinks.campaignAnnouncementUrl)), sameDetailAndApply: n((r) => r.recruitmentLinks.applyUrl && r.recruitmentLinks.applyUrl === r.recruitmentLinks.campaignAnnouncementUrl), ats: n((r) => Boolean(r.ats)), officialWechat: categories('official_wechat_announcement'), universityReposts: categories('university_repost'), governmentReposts: categories('government_repost'), aggregatorsOrMedia: categories('aggregator_source') + categories('media_article'), unknown: categories('unknown') + categories('wechat_identity_unproven') + categories('ats_platform_recognized'), staleOrExpired: n((r) => r.staleOrExpired), activeVerified: n((r) => r.verificationStatus === 'active_verified'), manualReviewProjects: manualReviewProjectIds.size, manualReviewMappings: reviewObjectMap.size }, decisions: Object.fromEntries([...new Set(allLinks.map((item) => item.decision))].map((decision) => [decision, categories(decision)])), reviewReasons: reviewReasons.reduce((out, reason) => ({ ...out, [reason]: (out[reason] || 0) + 1 }), {}), reviewMappings: [...reviewObjectMap.values()].sort((a, b) => b.affectedRecords - a.affectedRecords), duplicateUrlGroups, records: governed };
}
