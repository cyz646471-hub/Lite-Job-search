import { classifyRecruitmentUrl, unwrapNowcoderJump } from './official-links.mjs';
import { resolveFinalRecruitmentUrl } from './cn-recruitment-project.mjs';
import { scoreOfficialCandidate } from './cn-official-search.mjs';
import { detectAtsFingerprint } from './cn-ats-fingerprint.mjs';

const HIGH_PATHS = ['/careers', '/jobs', '/join', '/recruit', '/campus'];
const LINK_TEXT = /加入我们|人才招聘|校园招聘|招聘职位|careers|jobs|join us/i;

function links(html = '', base = '') {
  return [...String(html).matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => {
    try {
      return { url: new URL(match[1], base).href, title: match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
    } catch { return null; }
  }).filter(Boolean);
}

function robotsDisallows(text = '') {
  return String(text).split(/\r?\n/).map((line) => line.match(/^\s*Disallow:\s*(\S+)/i)?.[1]).filter(Boolean);
}

function decorate(candidate, project) {
  const score = scoreOfficialCandidate(candidate, project);
  const atsFingerprint = detectAtsFingerprint({ url: candidate.url, html: `${candidate.title || ''}\n${candidate.snippet || ''}` });
  return { ...candidate, score, atsFingerprint };
}

export async function deterministicOfficialDiscovery(project = {}, { fetcher = fetch, maxPathProbes = 5 } = {}) {
  const evidence = [], candidates = [], rejected = [], disallowed = [];
  const save = (candidate) => {
    const decorated = decorate(candidate, project);
    if (decorated.score.decision === 'reject') rejected.push({ ...decorated, rejectionReason: decorated.rejectionReason || decorated.score.hardRejectReasons.join('; ') || 'score_below_threshold' });
    else candidates.push(decorated);
  };
  const seeds = [...new Set([
    project.finalApplyUrl,
    project.officialUrl,
    project.applyUrl,
    ...(project.sourceLinks || []).map((item) => item.url),
  ].filter(Boolean).map(unwrapNowcoderJump))];

  for (const seed of seeds) {
    const resolved = await resolveFinalRecruitmentUrl(seed, { fetcher, timeoutMs: 15_000 });
    save({
      url: resolved.url,
      title: '',
      snippet: resolved.rawContent?.slice(0, 2_000) || '',
      rank: 1,
      discoveryMethod: 'embedded_or_redirect',
      redirectChain: resolved.chain,
      reachable: resolved.status === 'resolved',
    });
    evidence.push({ method: 'redirect', requestedUrl: seed, finalUrl: resolved.url, status: resolved.status });
  }

  const domain = String(project.officialDomain || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (domain) {
    const origin = `https://${domain}`;
    for (const special of ['/', '/robots.txt', '/sitemap.xml']) {
      try {
        const response = await fetcher(new URL(special, origin), { headers: { 'user-agent': 'Career-OP/1.20' } });
        const text = await response.text();
        evidence.push({ method: special === '/' ? 'homepage' : special.slice(1), url: response.url || new URL(special, origin).href, status: response.status });
        if (special === '/robots.txt') disallowed.push(...robotsDisallows(text));
        if (special === '/') {
          for (const link of links(text, response.url || origin).filter((item) => LINK_TEXT.test(`${item.title} ${item.url}`))) save({ ...link, snippet: link.title, rank: 1, discoveryMethod: 'homepage_link' });
        } else {
          for (const match of text.matchAll(/https?:\/\/[^\s<"']+(?:career|job|join|recruit|campus)[^\s<"']*/gi)) save({ url: match[0], title: '', snippet: '', rank: 1, discoveryMethod: special.slice(1) });
        }
      } catch (error) {
        evidence.push({ method: special.slice(1) || 'homepage', status: 'request_error', error: String(error?.message || error).slice(0, 200) });
      }
    }

    for (const probePath of HIGH_PATHS.slice(0, maxPathProbes)) {
      if (disallowed.some((rule) => rule !== '/' && probePath.startsWith(rule))) {
        rejected.push({ url: new URL(probePath, origin).href, discoveryMethod: 'well_known_path', rejectionReason: 'robots_disallow' });
        continue;
      }
      try {
        const response = await fetcher(new URL(probePath, origin), { method: 'GET', redirect: 'follow', headers: { 'user-agent': 'Career-OP/1.20' } });
        const text = await response.text();
        const candidate = decorate({ url: response.url || new URL(probePath, origin).href, title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '', snippet: text.slice(0, 2_000), rank: 1, discoveryMethod: 'well_known_path', reachable: response.ok }, project);
        if (response.ok && candidate.score.decision !== 'reject') candidates.push(candidate);
        else rejected.push({ ...candidate, rejectionReason: response.ok ? 'score_below_threshold' : `http_${response.status}` });
      } catch (error) {
        rejected.push({ url: new URL(probePath, origin).href, discoveryMethod: 'well_known_path', rejectionReason: String(error?.message || error).slice(0, 200) });
      }
    }
  }

  const unique = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
  return {
    projectId: project.projectId,
    company: project.company,
    candidates: unique(candidates).sort((a, b) => b.score.totalScore - a.score.totalScore),
    rejected: unique(rejected),
    evidence,
  };
}
