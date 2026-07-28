import { detectAtsFingerprint } from '../../../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { evaluateCandidateIdentity } from '../../../engine/upstream/planner/cn-identity-verifier.mjs';
import { classifySurfacePage } from '../../../engine/upstream/planner/cn-surface-drill.mjs';
import { registrableDomainOf } from '../../../engine/upstream/planner/cn-url-evidence.mjs';
import { classifyRecruitmentUrl } from '../../../engine/upstream/planner/official-links.mjs';
import { bootstrapOfficialDomain } from '../../verification/official-domain-bootstrap.mjs';
import { resolveAtsTenantOwnership } from '../../verification/ats-tenant-ownership.mjs';

const UNIVERSITY_HOSTS = ['ncss.cn', '91wllm.cn', '91wllm.com'];

function hostOf(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

function headingOf(html, level = 'h1') {
  return String(html || '').match(new RegExp(
    `<${level}\\b[^>]*>([\\s\\S]*?)<\\/${level}>`,
    'i',
  ))?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

function hardNegativeCode(url, page = {}) {
  const host = hostOf(url);
  const parsedUrl = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  const pathname = parsedUrl?.pathname.toLowerCase() || '';
  const routeValue = `${pathname} ${parsedUrl?.search || ''} ${parsedUrl?.hash || ''}`
    .toLowerCase();
  const html = page.html || page.body || '';
  const title = String(page.title || titleOf(html));
  const h1 = String(page.h1 || headingOf(html));
  const primaryText = `${title} ${h1}`;
  if (
    Number(page.status) === 404
    || Number(page.status) === 410
    || /^404\./i.test(host)
    || /\/(?:404|not-found)(?:\.html?)?(?:\/|$)/i.test(pathname)
  ) {
    return 'error_page_url';
  }
  if (
    /\/(?:antibot|captcha|verifycode)(?:\/|$)/i.test(pathname)
    || /^callback\./i.test(host)
  ) {
    return 'access_challenge_url';
  }
  if (
    /^(?:ibank|ebank|ebanks|pbank|mobilebank)\./i.test(host)
    && (
      /\/(?:eib|pweb)(?:\/|$)/i.test(pathname)
      || /(?:onlineapply|creditapply|loanapply|accountapply)/i.test(routeValue)
    )
  ) {
    return 'banking_business_application';
  }
  if (
    hostMatches(host, '36kr.com')
    && /^\/(?:p|topics)\//i.test(pathname)
  ) {
    return 'content_article_page';
  }
  if (UNIVERSITY_HOSTS.some((domain) => hostMatches(host, domain)) || /\.edu\.cn$/i.test(host)) {
    return 'university_employment_site';
  }
  if (classifyRecruitmentUrl(url).channel === 'discovery_index') return 'aggregator_domain';
  const newsPath = /\/(?:news|article|media|press)(?:\/|$)/i.test(pathname);
  const newsHeading = /新闻|转载|媒体报道|press release|news article/i.test(primaryText);
  if (newsPath && newsHeading) {
    return 'news_reprint';
  }
  const trainingPath = /\/(?:career-)?(?:training|coaching|bootcamp|peixun)(?:\/|$)/i
    .test(pathname);
  const trainingHeading = /培训机构|职业培训|求职培训|培训学校|培训中心|训练营|付费内推|求职辅导|career coaching|bootcamp/i
    .test(primaryText);
  if (trainingPath || trainingHeading) return 'training_provider';
  return '';
}

function recruitmentRouteRole(url, atsType = '') {
  let host = '';
  let pathname = '';
  let searchParams;
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
    searchParams = parsed.searchParams;
  } catch {
    return 'UNKNOWN';
  }
  if (/\/(?:job|position)s?\/[^/]+/i.test(pathname)) return 'JOB_DETAIL';
  if (/\/(?:job|position)s?(?:\/|$)/i.test(pathname)) return 'JOB_LIST';
  if (/\/(?:campus-recruitment|campus_apply|social-recruitment|campus)(?:\/|$)/i
    .test(pathname)) return 'CAMPAIGN';
  if (/^jobs?\./i.test(host) && searchParams.has('country')) return 'JOB_LIST';
  if (
    /^(?:career|careers|job|jobs|hr|recruit|campus)\./i.test(host)
    || /\/(?:career|careers|join-us|recruit|recruitment)(?:\/|$)/i.test(pathname)
  ) {
    return 'CAREER_HOME';
  }
  if (
    atsType
    && (
      /\/apply\/[^/]+(?:\/\d+)?\/?$/i.test(pathname)
      || /^(?:career|careers|job|jobs|hr|recruit|campus)\./i.test(host)
    )
  ) {
    return /\/\d+\/?$/.test(pathname) ? 'CAMPAIGN' : 'CAREER_HOME';
  }
  return 'UNKNOWN';
}

function isCorporateRoot(url, atsType = '') {
  if (atsType) return false;
  try {
    const parsed = new URL(url);
    const recruitmentSubdomain = /^(?:career|careers|job|jobs|hr|recruit|campus)\./i
      .test(parsed.hostname.toLowerCase());
    return (!parsed.pathname || parsed.pathname === '/') && !recruitmentSubdomain;
  } catch {
    return false;
  }
}

function pageText(page) {
  return String(page.html || page.body || page.text || '');
}

function normalizedIdentity(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function subjectMatchesCompany(subject, company = {}) {
  const observed = normalizedIdentity(subject);
  if (!observed) return false;
  return [
    company.canonicalName,
    company.chineseName,
    company.englishName,
    ...(company.aliases || []),
  ].some((value) => {
    const expected = normalizedIdentity(value);
    return expected.length >= 2 && observed.includes(expected);
  });
}

function isWechatArticle(url) {
  const host = hostOf(url);
  if (host !== 'mp.weixin.qq.com') return false;
  try {
    return /^\/s(?:\/|$)/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function careerPageIdentityConfirmed({ url, page = {} } = {}) {
  if (page.parsed?.careerPageConfirmed === true) return true;
  let host = '';
  let pathname = '';
  try {
    const parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
    pathname = parsed.pathname.toLowerCase();
  } catch {
    return false;
  }
  const title = String(page.title || titleOf(pageText(page)));
  const h1 = String(page.h1 || headingOf(pageText(page)));
  const headingSignal = /招聘|人才|加入|职位|岗位|校招|社招|实习|careers?|jobs?|join us|hiring/i
    .test(`${title} ${h1}`);
  const routeSignal = /^(?:career|careers|job|jobs|hr|recruit|campus)\./i.test(host)
    || /\/(?:career|careers|job|jobs|join-us|recruit|recruitment|hr|campus)(?:\/|$)/i
      .test(pathname);
  return headingSignal && routeSignal;
}

function titleOf(html) {
  return String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

export function createOfficialVerificationAdapter({
  detectAts = detectAtsFingerprint,
  classifyPage = classifySurfacePage,
  evaluateIdentity = evaluateCandidateIdentity,
  resolveTenantOwnership = resolveAtsTenantOwnership,
  now = () => new Date().toISOString(),
} = {}) {
  return Object.freeze({
    async inspect({
      company = {},
      candidate = {},
      page = {},
    } = {}) {
      const finalUrl = page.finalUrl || page.url || candidate.url || '';
      if (candidate.sourceTier === 'PLATFORM_ONLY') {
        return Object.freeze({
          pageType: 'JOB_LIST',
          vacancyStatus: 'UNKNOWN',
          atsType: '',
          registrableDomain: registrableDomainOf(finalUrl),
          confirmedOfficialDomain: null,
          evidence: Object.freeze([{
            code: 'aggregator_domain',
            observedValue: null,
            sourceUrl: finalUrl || null,
            observedAt: now(),
          }]),
        });
      }
      const html = pageText(page);
      const classified = classifyPage({
        url: finalUrl,
        html,
        status: page.status,
        parsed: page.parsed,
      }) || { pageRole: 'UNKNOWN', vacancyStatus: 'UNKNOWN', links: [] };
      const ats = detectAts({
        url: finalUrl,
        html,
        cookies: page.cookies || [],
        requests: page.requests || [],
      }) || { ats: '', confidence: 0 };
      const hardNegative = hardNegativeCode(finalUrl, { ...page, html })
        || hardNegativeCode(candidate.url, { ...page, html });
      const routeRole = recruitmentRouteRole(finalUrl, ats.ats);
      const resolvedPageRole = hardNegative
        ? 'UNKNOWN'
        : routeRole !== 'UNKNOWN'
          ? routeRole
          : isCorporateRoot(finalUrl, ats.ats)
            ? 'CORPORATE_HOME'
            : classified.pageRole;
      const wechatArticle = isWechatArticle(finalUrl);
      const existingOfficialDomains = [...new Set(company.officialDomains || [])];
      const bootstrap = existingOfficialDomains.length || hardNegative || wechatArticle
        ? null
        : bootstrapOfficialDomain({
          company,
          candidate,
          page,
          pageType: resolvedPageRole,
          atsType: ats.ats,
        });
      const confirmedOfficialDomain = bootstrap?.status === 'CONFIRMED'
        ? bootstrap.registrableDomain
        : null;
      const effectiveOfficialDomains = confirmedOfficialDomain
        ? [...new Set([...existingOfficialDomains, confirmedOfficialDomain])]
        : existingOfficialDomains;
      const identity = evaluateIdentity({
        companyEntity: {
          canonicalName: company.canonicalName,
          brandNames: [company.canonicalName, ...(company.aliases || [])].filter(Boolean),
          officialCorporateDomains: effectiveOfficialDomains,
        },
        candidate: {
          ...candidate,
          finalUrl,
          autoOfficialDomain: false,
        },
        page: {
          reachable: Number(page.status || 200) < 400,
          httpStatus: page.status || 200,
          title: page.title || titleOf(html),
          h1: page.h1 || '',
          recruitmentSemantics: !['UNKNOWN', 'CORPORATE_HOME'].includes(resolvedPageRole),
          jobContentMatched: ['JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(resolvedPageRole),
          officialSiteLinked: page.officialSiteLinked === true,
          riskSignals: page.riskSignals || [],
        },
        pageRole: resolvedPageRole,
        vacancyStatus: classified.vacancyStatus,
      }) || {};

      const evidence = [];
      const seen = new Set();
      const push = (code, observedValue = null) => {
        if (!code || seen.has(code)) return;
        seen.add(code);
        evidence.push({
          code,
          observedValue,
          sourceUrl: finalUrl || null,
          observedAt: now(),
        });
      };

      push(hardNegative);
      if ((identity.riskSignals || []).includes('identity_conflict')) {
        push('company_identity_conflict');
      }
      if ((identity.riskSignals || []).some((item) => [
        'personal_form_or_cloud_drive',
        'payment_or_private_contact_risk',
      ].includes(item))) {
        push('private_or_payment_risk');
      }

      const finalDomain = registrableDomainOf(finalUrl);
      const officialDomainMatch = effectiveOfficialDomains
        .map(registrableDomainOf)
        .filter(Boolean)
        .includes(finalDomain);
      if (officialDomainMatch) push('official_domain_match', finalDomain);
      else push('candidate_self_domain', finalDomain);
      if (confirmedOfficialDomain) {
        push('company_brand_match', bootstrap.matchedSignals.join(','));
        push('domain_bootstrap_confirmed', confirmedOfficialDomain);
      }

      const officialSiteBacklink = candidate.officialSiteLinked === true
        || page.officialSiteLinked === true
        || (identity.strongEvidence || []).includes('official_site_links_surface');
      const officialAttributionDomain = registrableDomainOf(
        candidate.officialAttributionUrl || '',
      );
      const officialAttributionConfirmed = candidate.parentOfficialVerified === true
        && Boolean(candidate.officialAttributionUrl)
        && effectiveOfficialDomains
          .map(registrableDomainOf)
          .filter(Boolean)
          .includes(officialAttributionDomain);

      const officialAccountName = String(
        page.officialAccountName
        || page.parsed?.officialAccountName
        || page.parsed?.accountName
        || candidate.officialAccountName
        || '',
      ).trim();
      const officialAccountId = String(
        page.officialAccountId
        || page.parsed?.officialAccountId
        || page.parsed?.accountId
        || candidate.officialAccountId
        || '',
      ).trim();
      const verifiedSubject = String(
        page.verifiedSubject
        || page.parsed?.verifiedSubject
        || candidate.verifiedSubject
        || '',
      ).trim();

      let atsTenantVerified = false;
      if (ats.ats) {
        const reviewedOwnership = resolveTenantOwnership({
          company,
          url: finalUrl,
          atsType: ats.ats,
        });
        const tenantVerified = candidate.verifiedTenant === true
          || (identity.strongEvidence || []).includes('verified_surface_registry')
          || reviewedOwnership.status === 'VERIFIED';
        atsTenantVerified = tenantVerified;
        push(tenantVerified ? 'verified_ats_tenant' : 'ats_fingerprint_only', ats.ats);
        if (reviewedOwnership.status === 'VERIFIED') {
          push(
            'reviewed_ats_tenant_ownership',
            `${ats.ats}:${reviewedOwnership.record.tenantKey}`,
          );
        }
        if (tenantVerified && officialAttributionConfirmed) {
          push('official_site_confirms_ats_tenant', ats.ats);
        }
      }
      if (ats.ats && atsTenantVerified && routeRole !== 'UNKNOWN') {
        push('ats_recruitment_route', routeRole);
      }
      if (resolvedPageRole === 'CORPORATE_HOME') {
        push('corporate_home_only');
      }
      const observedRecruitmentRole = [
        'CAMPAIGN',
        'JOB_LIST',
        'JOB_DETAIL',
        'APPLY',
      ].includes(classified.pageRole)
        ? classified.pageRole
        : [
            'CAMPAIGN',
            'JOB_LIST',
            'JOB_DETAIL',
            'APPLY',
          ].includes(routeRole)
          ? routeRole
          : null;
      if (
        !hardNegative
        && resolvedPageRole !== 'CORPORATE_HOME'
        && observedRecruitmentRole
      ) {
        push('recruitment_structure', observedRecruitmentRole);
      } else if (
        resolvedPageRole === 'CAREER_HOME'
        && careerPageIdentityConfirmed({ url: finalUrl, page: { ...page, html } })
      ) {
        push('career_page_identity', resolvedPageRole);
      }
      if (wechatArticle) {
        if (
          candidate.verifiedSubjectMatch === true
          || page.verifiedSubjectMatch === true
          || subjectMatchesCompany(verifiedSubject, company)
        ) {
          push('wechat_verified_subject_match', verifiedSubject || officialAccountName);
        }
        if (officialAttributionConfirmed) {
          push(
            'official_site_confirms_wechat_account',
            officialAccountId || officialAccountName || finalUrl,
          );
        }
        if (['CAMPAIGN', 'JOB_LIST', 'JOB_DETAIL', 'APPLY'].includes(resolvedPageRole)) {
          push('official_recruitment_announcement', resolvedPageRole);
        }
      }
      if (
        resolvedPageRole === 'APPLY'
        || page.parsed?.applyUrl
        || candidate.applyUrl
        || /立即(?:申请|投递)|apply now|submit application/i.test(html)
      ) {
        push('apply_action');
      }
      if (
        officialSiteBacklink
      ) {
        push('official_site_backlink');
      }
      if ((identity.strongEvidence || []).includes('legal_entity_match')) push('legal_entity_match');
      if ((identity.strongEvidence || []).includes('official_announcement_lists_url')) {
        push('official_announcement_lists_url');
      }
      if (
        classified.vacancyStatus === 'BLOCKED'
        || [401, 403, 429].includes(Number(page.status))
      ) {
        push('blocked_page');
      }

      return Object.freeze({
        pageType: resolvedPageRole || 'UNKNOWN',
        vacancyStatus: classified.vacancyStatus || 'UNKNOWN',
        atsType: ats.ats || '',
        channelType: wechatArticle
          ? 'WECHAT_OFFICIAL_ACCOUNT'
          : ats.ats
            ? 'ATS'
            : 'WEB_PORTAL',
        officialAccountName: officialAccountName || null,
        officialAccountId: officialAccountId || null,
        verifiedSubject: verifiedSubject || null,
        registrableDomain: finalDomain,
        confirmedOfficialDomain,
        evidence: Object.freeze(evidence),
      });
    },
  });
}
