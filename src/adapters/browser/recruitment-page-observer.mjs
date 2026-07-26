import { isBaiduBlockedSnapshot } from './baidu-search-page-adapter.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeLinks(links = []) {
  return Object.freeze((links || []).map((link) => ({
    text: clean(link?.text),
    href: String(link?.href || '').trim(),
  })).filter((link) => link.text && /^https?:\/\//i.test(link.href)));
}

export async function captureRenderedSnapshot(page) {
  if (typeof page?.snapshot === 'function') {
    const snapshot = await page.snapshot();
    return {
      text: String(snapshot?.text || ''),
      html: String(snapshot?.html || ''),
      title: clean(snapshot?.title),
      h1: clean(snapshot?.h1),
      links: sanitizeLinks(snapshot?.links),
    };
  }
  const text = await page.locator('body').innerText().catch(() => '');
  const html = await page.locator('html')
    .evaluate((node) => node.outerHTML)
    .catch(() => '');
  const title = typeof page.title === 'function'
    ? await page.title().catch(() => '')
    : '';
  const h1 = await page.locator('h1').innerText().catch(() => '');
  const links = await page.locator('a[href]').evaluateAll((anchors) => anchors.map((anchor) => ({
    text: (anchor.innerText || anchor.textContent || '').trim(),
    href: anchor.href,
  }))).catch(() => []);
  return {
    text,
    html,
    title: clean(title),
    h1: clean(h1),
    links: sanitizeLinks(links),
  };
}

export function hasRecruitmentStructure(snapshot = {}) {
  return /职位|岗位|招聘|job openings?|open positions?|vacanc(?:y|ies)/i
    .test(String(snapshot.text || ''));
}

export function hasExplicitNoOpenings(snapshot = {}) {
  return /暂无(?:职位|岗位|招聘)|没有(?:职位|岗位)|no open positions|no jobs found|no vacancies/i
    .test(String(snapshot.text || ''));
}

export async function observeRenderedRecruitmentPage(page, {
  requestedUrl,
  response = null,
  observedAt = null,
  renderWaitMs = 3_000,
  pollIntervalMs = 250,
  now = () => new Date().toISOString(),
} = {}) {
  const status = Number(response?.status?.()) || 200;
  const maximumPolls = Math.max(
    0,
    Math.ceil(Math.max(0, Number(renderWaitMs) || 0) / Math.max(1, Number(pollIntervalMs) || 250)),
  );
  let snapshot = await captureRenderedSnapshot(page);
  for (let poll = 0; poll < maximumPolls; poll++) {
    const blocked = isBaiduBlockedSnapshot({
      text: snapshot.text,
      status,
      url: requestedUrl,
    });
    if (blocked || hasRecruitmentStructure(snapshot) || hasExplicitNoOpenings(snapshot)) break;
    await page.waitForTimeout(pollIntervalMs);
    snapshot = await captureRenderedSnapshot(page);
  }

  const finalUrl = await page.url();
  const blocked = isBaiduBlockedSnapshot({
    text: snapshot.text,
    status,
    url: finalUrl,
  });
  const recruitmentStructure = hasRecruitmentStructure(snapshot);
  const noOpenings = hasExplicitNoOpenings(snapshot);
  return Object.freeze({
    requestedUrl,
    finalUrl,
    url: finalUrl,
    status,
    fetchStatus: blocked ? 'BLOCKED' : 'COMPLETED',
    reasonCode: blocked ? 'challenge_or_access_blocked' : null,
    text: snapshot.text,
    html: snapshot.html,
    title: snapshot.title,
    h1: snapshot.h1,
    links: snapshot.links,
    observedAt: observedAt || now(),
    hasJobStructure: recruitmentStructure,
    vacancyStatus: blocked
      ? 'BLOCKED'
      : noOpenings
        ? 'NO_OPENINGS'
        : recruitmentStructure
          ? 'UNKNOWN'
          : 'NOT_A_LIST',
    evidence: snapshot.text.slice(0, blocked ? 500 : 1_000),
  });
}
