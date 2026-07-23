import { htmlToText } from './core.mjs';
import { resolveDetailProvider } from './detail-providers/_registry.mjs';
import { locationText } from './detail-providers/_helpers.mjs';
import { classifyLiveness } from '../liveness-core.mjs';
import { parseJobPostingJsonLd } from './page-providers/_jsonld.mjs';
import { resolvePageProvider } from './page-providers/_registry.mjs';

const DEFAULT_DELAY_MS = 1500;
const DEFAULT_TIMEOUT_MS = 15000;

// Transparent product identifier for low-rate public-page verification.
const PRODUCT_UA = 'career-ops-planner/1.19 (+public recruitment verification)';

export async function politeFetch(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = options.attempts ?? 3;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          accept: options.accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'user-agent': options.userAgent || PRODUCT_UA,
          'cache-control': 'no-cache',
          pragma: 'no-cache',
          ...(options.headers || {}),
        },
        redirect: 'follow', signal: controller.signal,
      });
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
      } else {
        return response;
      }
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, DEFAULT_DELAY_MS * 2 ** attempt));
  }
  throw lastError || new Error('fetch failed');
}

export async function resolveDetailApi(rawUrl) {
  return resolveDetailProvider(rawUrl);
}

export function parseApiDetail(api, json, originalUrl) {
  const parsed = api.provider.parse(json, { originalUrl, match: api.match });
  return parsed ? { ...parsed, source: api.source, sourceType: 'official_ats', sourceUrl: originalUrl } : null;
}

export function reconcileApiInconclusive(liveness, apiReason = '') {
  if (!apiReason) return liveness;
  if (liveness.code === 'insufficient_content' || liveness.code === 'no_apply_control') {
    return { result: 'uncertain', code: 'ats_api_inconclusive', reason: `${apiReason}; static page was not independently verifiable` };
  }
  return liveness;
}

export function parseJsonLdFromHtml(html, originalUrl) {
  return parseJobPostingJsonLd(html, originalUrl);
}

function absoluteUrl(value, baseUrl) {
  try { return new URL(value, baseUrl).href; } catch { return ''; }
}

export function extractCompanyLinks(html, finalUrl) {
  const links = [];
  for (const match of String(html).matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = match[1].match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const url = absoluteUrl(href, finalUrl);
    if (!url || !url.startsWith('https://')) continue;
    links.push({ url, text: htmlToText(match[2]) });
  }
  const recruitingHost = (host = '') => /(?:^|\.)(?:greenhouse\.io|greenhouse\.com|ashbyhq\.com|ashby\.com|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|teamtailor\.com|ycombinator\.com)$/i.test(host);
  const excludedHost = (host = '') => recruitingHost(host)
    || /(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|github\.com|google\.com)$/i.test(host);
  let finalHost = '';
  try { finalHost = new URL(finalUrl).hostname; } catch {}
  const externalCompanyLink = links.find((item) => {
    try {
      const parsed = new URL(item.url);
      if (parsed.hostname === finalHost || excludedHost(parsed.hostname)) return false;
      if (/privacy|terms|cookie|accessibility|support|help|mailto|login|sign in/i.test(`${item.text} ${parsed.pathname}`)) return false;
      return parsed.pathname === '/' || /company|about|home|website/i.test(item.text);
    } catch { return false; }
  });
  const companyWebsite = !recruitingHost(finalHost) && finalHost
    ? new URL(finalUrl).origin
    : externalCompanyLink ? new URL(externalCompanyLink.url).origin : '';
  const campus = links.find((item) => /students?|university|universities|graduates?|campus|early careers?|internships?/i.test(`${item.text} ${item.url}`));
  const careers = links.find((item) => /careers?|jobs?|join us|open positions?/i.test(`${item.text} ${item.url}`));
  return { companyWebsite, careerSite: careers?.url || '', campusSite: campus?.url || '' };
}

export function isApiPostingMissing(api, json, originalUrl) {
  return api.provider.isMissing?.(json, { originalUrl, match: api.match }) === true;
}

function extractApplyControls(html = '') {
  const controls = [];
  const tags = String(html).match(/<(?:a|button)\b[^>]*>[\s\S]*?<\/(?:a|button)>/gi) || [];
  for (const tag of tags) {
    const text = htmlToText(tag);
    const aria = tag.match(/\b(?:aria-label|title)=["']([^"']+)["']/i)?.[1] || '';
    const value = `${text} ${aria}`.trim();
    if (value) controls.push(value);
  }
  return controls;
}

export async function fetchJobDetail(url, options = {}) {
  const api = await resolveDetailApi(url);
  let apiInconclusiveReason = '';
  if (api) {
    try {
      const response = await politeFetch(api.url, { ...options, accept: 'application/json' });
      if (response.status === 404 || response.status === 410) {
        // Some ATS public pages remain live briefly while their JSON endpoint is
        // unavailable. Fall back to the posting page before declaring it dead.
        apiInconclusiveReason = `${api.source} API returned HTTP ${response.status}`;
      } else if (response.ok) {
        const json = await response.json();
        const detail = parseApiDetail(api, json, url);
        if (detail) {
          const expired = detail.expiresAt && Date.parse(detail.expiresAt) < Date.now();
          return {
            ...detail,
            url: detail.applyUrl || url,
            livenessStatus: expired ? 'expired' : 'active',
            livenessReason: expired ? `validThrough elapsed: ${detail.expiresAt}` : `${api.source} API returned posting`,
            lastVerifiedAt: new Date().toISOString(),
          };
        }
        if (isApiPostingMissing(api, json, url)) {
          return { livenessStatus: 'expired', livenessReason: `${api.source} API no longer lists this posting`, sourceUrl: url, url };
        }
        return { livenessStatus: 'uncertain', livenessReason: `${api.source} API response shape was not recognized`, sourceUrl: url, url };
      } else {
        apiInconclusiveReason = `${api.source} API returned HTTP ${response.status}`;
      }
    } catch (error) {
      apiInconclusiveReason = `${api.source} API request failed: ${error.message}`;
    }
  }

  const response = await politeFetch(url, options);
  const finalUrl = response.url || url;
  if (response.status === 404 || response.status === 410) return { livenessStatus: 'expired', livenessReason: `HTTP ${response.status}`, sourceUrl: url, url: finalUrl };
  const html = await response.text();
  const text = htmlToText(html);
  const pageProvider = await resolvePageProvider(finalUrl);
  const jsonLd = pageProvider?.parse(html, { requestedUrl: url, finalUrl }) || {};
  const companyLinks = extractCompanyLinks(html, finalUrl);
  let liveness = classifyLiveness({
    status: response.status,
    requestedUrl: url,
    finalUrl,
    bodyText: text,
    applyControls: extractApplyControls(html),
  });
  liveness = reconcileApiInconclusive(liveness, apiInconclusiveReason);
  if (jsonLd.expiresAt && Date.parse(jsonLd.expiresAt) < Date.now()) {
    liveness = { result: 'expired', code: 'valid_through_elapsed', reason: `validThrough elapsed: ${jsonLd.expiresAt}` };
  }
  return {
    ...companyLinks, ...jsonLd, url: jsonLd.applyUrl || finalUrl, sourceUrl: url, description: jsonLd.description || text,
    pageProvider: pageProvider?.id || '',
    livenessStatus: liveness.result,
    livenessReason: `${liveness.code}: ${liveness.reason}`,
    lastVerifiedAt: new Date().toISOString(),
  };
}
