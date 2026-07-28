function titleOf(html) {
  return String(html || '').match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || '';
}

function requiresRenderedFallback(page) {
  const html = String(page?.html || '');
  const visibleSignals = /招聘|职位|岗位|加入我们|careers?|jobs?|apply/i.test(html);
  const shellSignals = /id=["'](?:app|root)["']|__NEXT_DATA__|webpack|vite/i.test(html);
  return page?.status < 400 && (!visibleSignals || html.length < 800) && shellSignals;
}

function linksFromHtml(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) && links.length < 500) {
    try {
      if (match[1].trim().startsWith('#')) continue;
      const decodedHref = match[1]
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/g, '&');
      const resolved = new URL(decodedHref, baseUrl);
      if (!['http:', 'https:'].includes(resolved.protocol)) continue;
      links.push({
        href: resolved.href,
        text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    } catch {
      // Invalid links remain outside the deterministic candidate set.
    }
  }
  return links;
}

function normalizedRecruitmentUrl(value) {
  try {
    const url = new URL(value);
    if (/(^|\.)mokahr\.(?:com|cn)$/i.test(url.hostname)) {
      if (/\/campus_apply\//i.test(url.pathname)) return null;
      const directory = url.pathname.match(
        /^\/(?:campus-recruitment|social-recruitment)\/[^/]+\/[^/]+/i,
      )?.[0] || url.pathname.match(/^\/apply\/[^/]+/i)?.[0];
      if (directory) {
        url.pathname = directory;
        url.search = '';
        url.hash = '';
      }
    }
    return url.href;
  } catch {
    return null;
  }
}

function recruitmentLinks(page, baseUrl) {
  const values = linksFromHtml(page?.html, baseUrl)
    .filter((link) => /招聘|职位|岗位|加入我们|careers?|jobs?|positions?|openings?|vacanc|join-us|recruit|apply/i
      .test(`${link.text} ${link.href}`))
    .map((link) => normalizedRecruitmentUrl(link.href))
    .filter(Boolean);
  const sitemapUrls = [...String(page?.html || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map((match) => match[1])
    .filter((url) => /careers?|jobs?|positions?|openings?|vacanc|join-us|recruit|apply/i.test(url));
  return [...new Set([...values, ...sitemapUrls.map(normalizedRecruitmentUrl).filter(Boolean)])];
}

function mokaJobFilterProbe(page, baseUrl) {
  const baseDirectory = normalizedRecruitmentUrl(baseUrl);
  if (!baseDirectory || !/(^|\.)mokahr\.(?:com|cn)$/i.test(new URL(baseDirectory).hostname)) {
    return null;
  }
  const links = page?.links?.length ? page.links : linksFromHtml(page?.html, baseUrl);
  for (const link of links) {
    try {
      const href = String(link?.href || '')
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/g, '&');
      const resolved = new URL(href, baseUrl);
      if (!/\/jobs?(?:\/|\?|$)/i.test(`${resolved.pathname}${resolved.hash}`)) continue;
      if (normalizedRecruitmentUrl(resolved.href) === baseDirectory
        && resolved.href !== baseDirectory) {
        return resolved.href;
      }
    } catch {
      // Invalid dynamic navigation cannot become a traversal probe.
    }
  }
  return null;
}

function hostMatchesOfficialDomain(value, officialDomains = []) {
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
    return officialDomains.some((domain) => {
      const normalized = String(domain || '').toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
      return host === normalized || host.endsWith(`.${normalized}`);
    });
  } catch {
    return false;
  }
}

function isKnownAtsUrl(value) {
  try {
    return /(^|\.)(?:mokahr\.(?:com|cn)|zhiye\.com|hotjob\.cn|jobs\.feishu\.cn|myworkdayjobs\.com)$/i
      .test(new URL(value).hostname);
  } catch {
    return false;
  }
}

export async function discoverCompanyLocally({
  company,
  plan,
  fetchPage,
  observeWithBrowser = null,
  resolveAts = resolvePageProvider,
  maxBrowserFallbacks = 3,
  maxElapsedMs = 120_000,
  now = () => Date.now(),
} = {}) {
  if (!company || !plan || typeof fetchPage !== 'function') {
    throw new Error('company, plan and fetchPage are required');
  }
  const observations = [];
  const officialCandidates = [];
  const candidateMetadata = new Map();
  const traversalOnly = new Set();
  const failures = [];
  let completedObservations = 0;
  const candidateSet = new Set(plan.candidates || []);
  const queue = [...candidateSet];
  for (const domain of plan.officialDomains || []) {
    const root = `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
    queue.push(`${root}/robots.txt`, `${root}/sitemap.xml`);
  }
  const visited = new Set();
  let browserFallbacks = 0;
  const startedAtMs = now();
  const elapsedBudgetMs = Math.max(30_000, Number(maxElapsedMs) || 120_000);
  const withinElapsedBudget = () => now() - startedAtMs < elapsedBudgetMs;

  const canUseBrowserFallback = (url) => (
    typeof observeWithBrowser === 'function'
    && candidateSet.has(url)
    && browserFallbacks < Math.max(0, Number(maxBrowserFallbacks) || 0)
  );

  const observeFallback = async (url, method) => {
    browserFallbacks += 1;
    const page = await observeWithBrowser(url);
    return {
      page,
      method,
    };
  };

  while (queue.length && visited.size < 30 && withinElapsedBudget()) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      let page;
      let method = 'DIRECT_HTTP';
      let directError = null;
      try {
        page = await fetchPage(url);
      } catch (error) {
        directError = error;
        if (!canUseBrowserFallback(url)) throw error;
        ({ page, method } = await observeFallback(
          url,
          'PLAYWRIGHT_FALLBACK_AFTER_HTTP_ERROR',
        ));
      }
      if (
        method === 'DIRECT_HTTP'
        && [401, 403, 429].includes(Number(page?.status))
        && canUseBrowserFallback(url)
      ) {
        ({ page, method } = await observeFallback(
          page.finalUrl || url,
          'PLAYWRIGHT_FALLBACK_AFTER_HTTP_STATUS',
        ));
      }
      const directFinalUrl = page.finalUrl || url;
      const atsProvider = typeof resolveAts === 'function'
        ? await resolveAts(directFinalUrl)
        : null;
      const atsParsed = atsProvider?.parse(page.html || '', {
        requestedUrl: url,
        finalUrl: directFinalUrl,
      });
      const atsJobs = atsParsed?.activeJobs || atsParsed?.jobs || atsParsed?.positions || [];
      if (Array.isArray(atsJobs) && atsJobs.length) {
        page = {
          ...page,
          jobs: atsJobs,
          atsType: atsProvider.id,
        };
        method = 'ATS_ADAPTER';
      } else if (requiresRenderedFallback(page) && typeof observeWithBrowser === 'function') {
        if (canUseBrowserFallback(url)) {
          ({ page, method } = await observeFallback(
            page.finalUrl || url,
            'PLAYWRIGHT_FALLBACK',
          ));
        }
      }
      const finalUrl = page.finalUrl || url;
      completedObservations += 1;
      const links = linksFromHtml(page.html, finalUrl);
      observations.push({
        ...page,
        requestedUrl: url,
        finalUrl,
        url: finalUrl,
        title: page.title || titleOf(page.html),
        links,
        observationMethod: method,
        directFetchError: directError ? String(directError?.message || directError) : null,
      });
      for (const recruitmentUrl of recruitmentLinks(page, finalUrl)) {
        if (
          hostMatchesOfficialDomain(finalUrl, plan.officialDomains)
          && isKnownAtsUrl(recruitmentUrl)
        ) {
          candidateMetadata.set(recruitmentUrl, {
            parentOfficialVerified: true,
            officialAttributionUrl: finalUrl,
            discoveryReason: 'verified_official_outbound_ats_link',
          });
        }
        if (!visited.has(recruitmentUrl)) {
          candidateSet.add(recruitmentUrl);
          queue.unshift(recruitmentUrl);
        }
      }
      if (!(page.jobs || []).length) {
        const filterProbe = mokaJobFilterProbe(page, finalUrl);
        if (filterProbe && !visited.has(filterProbe)) {
          traversalOnly.add(filterProbe);
          candidateSet.add(filterProbe);
          queue.unshift(filterProbe);
        }
      }
      if (
        candidateSet.has(url)
        && !traversalOnly.has(url)
        && Number(page.status) >= 200
        && Number(page.status) < 400
      ) {
        officialCandidates.push({
          url: finalUrl,
          title: page.title || titleOf(page.html),
          rank: officialCandidates.length + 1,
          sourceUrl: url,
          discoveryReason: plan.stages.find((stage) => stage.count > 0)?.source
            || 'local_first_candidate',
          ...(candidateMetadata.get(normalizedRecruitmentUrl(url) || url) || {}),
        });
      }
    } catch (error) {
      observations.push({
        requestedUrl: url,
        finalUrl: url,
        url,
        status: 0,
        fetchStatus: 'FAILED',
        reasonCode: 'direct_candidate_fetch_failed',
        title: '',
        html: '',
        text: '',
        links: [],
        jobs: [],
        observationMethod: 'DIRECT_HTTP',
        error: String(error?.message || error),
      });
      failures.push({
        stage: 'LOCAL_OR_DIRECT_VERIFICATION',
        url,
        reasonCode: 'direct_candidate_fetch_failed',
        error: String(error?.message || error),
      });
    }
  }
  const observedUrls = new Set(observations.flatMap((item) => [
    item.requestedUrl,
    item.finalUrl,
    item.url,
  ]).filter(Boolean));
  for (const url of candidateSet) {
    if (observedUrls.has(url)) continue;
    observations.push({
      requestedUrl: url,
      finalUrl: url,
      url,
      status: 0,
      fetchStatus: 'DEFERRED',
      reasonCode: withinElapsedBudget()
        ? 'LOCAL_TRAVERSAL_BUDGET_EXHAUSTED'
        : 'LOCAL_TRAVERSAL_TIME_BUDGET_EXHAUSTED',
      title: '',
      html: '',
      text: '',
      links: [],
      jobs: [],
      observationMethod: 'NOT_VISITED',
    });
  }
  for (const source of observations.filter((item) => (
    traversalOnly.has(item.requestedUrl) && (item.jobs || []).length
  ))) {
    const directory = normalizedRecruitmentUrl(source.requestedUrl);
    const target = observations.find((item) => (
      !traversalOnly.has(item.requestedUrl)
      && normalizedRecruitmentUrl(item.requestedUrl || item.finalUrl) === directory
    ));
    if (target) {
      target.jobs = source.jobs;
      target.jobExtractionSourceUrl = source.finalUrl || source.requestedUrl;
    }
  }

  return Object.freeze({
    company: company.company || company.canonicalName,
    chineseName: company.chineseName || null,
    englishName: company.englishName || null,
    aliases: Object.freeze([...(company.aliases || [])]),
    officialDomain: company.officialDomain || company.primaryOfficialDomain || '',
    companyIdentityKey: company.id,
    query: plan.query,
    queries: Object.freeze([]),
    discoveryProvider: 'local_direct_verification',
    liveSearchExecuted: false,
    status: completedObservations ? 'COMPLETED' : 'FAILED',
    reasonCode: completedObservations ? null : 'local_candidates_unreachable',
    officialCandidates: Object.freeze(officialCandidates.map((candidate) => ({
      ...candidate,
      ...(candidateMetadata.get(
        normalizedRecruitmentUrl(candidate.sourceUrl || candidate.url)
          || candidate.sourceUrl
          || candidate.url,
      ) || {}),
    }))),
    platformCandidates: Object.freeze([]),
    leads: Object.freeze([]),
    rejected: Object.freeze([]),
    observations: Object.freeze(observations),
    failures: Object.freeze(failures),
    queryStatuses: Object.freeze([]),
    discoveryPlan: plan,
  });
}
import { resolvePageProvider } from '../../engine/upstream/planner/page-providers/_registry.mjs';
