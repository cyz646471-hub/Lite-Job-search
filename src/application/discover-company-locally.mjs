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
  const pattern = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) && links.length < 500) {
    try {
      links.push({
        href: new URL(match[1], baseUrl).href,
        text: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      });
    } catch {
      // Invalid links remain outside the deterministic candidate set.
    }
  }
  return links;
}

function recruitmentLinks(page, baseUrl) {
  const values = linksFromHtml(page?.html, baseUrl)
    .filter((link) => /招聘|职位|岗位|加入我们|careers?|jobs?|positions?|openings?|vacanc|join-us|recruit|apply/i
      .test(`${link.text} ${link.href}`))
    .map((link) => link.href);
  const sitemapUrls = [...String(page?.html || '').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map((match) => match[1])
    .filter((url) => /careers?|jobs?|positions?|openings?|vacanc|join-us|recruit|apply/i.test(url));
  return [...new Set([...values, ...sitemapUrls])];
}

export async function discoverCompanyLocally({
  company,
  plan,
  fetchPage,
  observeWithBrowser = null,
  resolveAts = resolvePageProvider,
} = {}) {
  if (!company || !plan || typeof fetchPage !== 'function') {
    throw new Error('company, plan and fetchPage are required');
  }
  const observations = [];
  const officialCandidates = [];
  const failures = [];
  let completedObservations = 0;
  const candidateSet = new Set(plan.candidates || []);
  const queue = [...candidateSet];
  for (const domain of plan.officialDomains || []) {
    const root = `https://${String(domain).replace(/^https?:\/\//, '').replace(/\/.*$/, '')}`;
    queue.push(`${root}/robots.txt`, `${root}/sitemap.xml`);
  }
  const visited = new Set();

  while (queue.length && visited.size < 30) {
    const url = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      let page = await fetchPage(url);
      let method = 'DIRECT_HTTP';
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
        page = await observeWithBrowser(page.finalUrl || url);
        method = 'PLAYWRIGHT_FALLBACK';
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
      });
      for (const recruitmentUrl of recruitmentLinks(page, finalUrl)) {
        if (!visited.has(recruitmentUrl)) {
          candidateSet.add(recruitmentUrl);
          queue.push(recruitmentUrl);
        }
      }
      if (candidateSet.has(url) && Number(page.status) >= 200 && Number(page.status) < 400) {
        officialCandidates.push({
          url: finalUrl,
          title: page.title || titleOf(page.html),
          rank: officialCandidates.length + 1,
          sourceUrl: url,
          discoveryReason: plan.stages.find((stage) => stage.count > 0)?.source
            || 'local_first_candidate',
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
      reasonCode: 'LOCAL_TRAVERSAL_BUDGET_EXHAUSTED',
      title: '',
      html: '',
      text: '',
      links: [],
      jobs: [],
      observationMethod: 'NOT_VISITED',
    });
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
    officialCandidates: Object.freeze(officialCandidates),
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
