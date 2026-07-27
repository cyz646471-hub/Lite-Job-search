import { isBaiduBlockedSnapshot } from './baidu-search-page-adapter.mjs';
import { extractDynamicRecruitmentJobs } from './dynamic-recruitment-site-adapter.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function sanitizeLinks(links = []) {
  return Object.freeze((links || []).map((link) => ({
    text: clean(link?.text),
    href: String(link?.href || '').trim(),
  })).filter((link) => link.text && /^https?:\/\//i.test(link.href)));
}

const GENERIC_RECRUITMENT_LINK_TEXT = /^(?:招聘|职位|岗位|职位列表|岗位列表|查看(?:全部)?职位|更多职位|立即申请|立即投递|申请|投递|社会招聘|校园招聘|实习生招聘|首页|返回|jobs?|careers?|open positions?|apply(?: now)?|more)$/i;
const JOB_TITLE_TERMS = /产品经理|工程师|开发|算法|设计师|导演|运营|市场|销售|财务|会计|人力|招聘专员|法务|研究员|分析师|管培生|实习生|测试|架构师|顾问|采购|供应链|客服|engineer|manager|designer|developer|scientist|analyst|intern|marketing|sales|operations?|consultant|architect|director/i;
const NON_OPENING_LINK_TEXT = /^(?:岗位?(?:分类|介绍|说明|指南|百科)|职位?(?:分类|介绍|说明|指南|百科)|筛选|搜索|人才社区|了解更多|job famil(?:y|ies)|category|filter|search)$/i;

function hasExplicitJobListingStructure(snapshot = {}) {
  return /招聘职位|招聘岗位|职位列表|岗位列表|在招职位|在招岗位|开启新的工作|job openings?|open positions?|current vacancies|positions available|find your new job/i
    .test(String(snapshot.text || ''));
}

function looksLikeJobDetailUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const path = url.pathname.replace(/\/+$/, '');
    return /\/(?:jobs?|positions?|openings?|job_detail|position_detail)\/[^/]+$/i.test(path)
      || /\/(?:jobs?|positions?)\/detail(?:\/|$)/i.test(path)
      || /\/(?:jobs?|positions?)\/[^/]+\/detail$/i.test(path);
  } catch {
    return false;
  }
}

function conciseJobTitle(value) {
  const withoutIdentifier = clean(value).split(/\s+(?:职位\s*ID|Position\s*ID)\b/i)[0];
  const locationAndType = withoutIdentifier.match(
    /^(.{2,100}?)\s+(?:北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|厦门|重庆|天津|新加坡|Singapore|Jakarta)\s*(?:正式|全职|实习|兼职|Regular|Intern)(?=\s|技术|运营|内容|研发|算法|设计|产品|市场|销售|$)/i,
  );
  return clean(locationAndType?.[1] || withoutIdentifier);
}

function explicitLocations(value) {
  const matches = clean(value).match(
    /北京|上海|深圳|广州|杭州|成都|武汉|南京|苏州|西安|厦门|重庆|天津|新加坡|Singapore|Jakarta/g,
  ) || [];
  return Object.freeze([...new Set(matches)]);
}

function explicitEmploymentType(value) {
  const text = clean(value);
  if (/实习|(?:^|[^a-z])intern(?:ship)?(?:[^a-z]|$)/i.test(text)) return 'internship';
  if (/正式|全职|regular|full[-\s]?time/i.test(text)) return 'full_time';
  return null;
}

function sourceJobIdFromUrl(value) {
  try {
    const path = new URL(String(value || '')).pathname;
    return decodeURIComponent(
      path.match(/\/(?:jobs?|positions?)\/([^/]+)\/detail(?:\/|$)/i)?.[1] || '',
    ) || null;
  } catch {
    return null;
  }
}

export function extractExplicitJobLinks(snapshot = {}) {
  if (!hasExplicitJobListingStructure(snapshot) || hasExplicitNoOpenings(snapshot)) {
    return Object.freeze([]);
  }
  const jobs = [];
  const seen = new Set();
  for (const link of sanitizeLinks(snapshot.links)) {
    const title = conciseJobTitle(link.text);
    if (!title || title.length > 120
      || GENERIC_RECRUITMENT_LINK_TEXT.test(title)
      || NON_OPENING_LINK_TEXT.test(title)) {
      continue;
    }
    if (!JOB_TITLE_TERMS.test(title) || !looksLikeJobDetailUrl(link.href)) continue;
    const key = `${title.toLowerCase()}|${link.href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const locations = explicitLocations(link.text);
    const employmentType = explicitEmploymentType(link.text);
    const sourceJobId = sourceJobIdFromUrl(link.href);
    const job = {
      title,
      jobDetailUrl: link.href,
      sourceUrl: link.href,
      status: 'ACTIVE',
    };
    if (sourceJobId) job.sourceJobId = sourceJobId;
    if (locations.length) job.locations = locations;
    if (employmentType) job.employmentType = employmentType;
    jobs.push(Object.freeze(job));
  }
  return Object.freeze(jobs);
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
  return /职位|岗位|招聘|开启新的工作|job openings?|open positions?|vacanc(?:y|ies)|find your new job/i
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
  const genericJobs = blocked ? Object.freeze([]) : extractExplicitJobLinks(snapshot);
  const dynamicJobs = blocked || noOpenings
    ? Object.freeze([])
    : extractDynamicRecruitmentJobs(snapshot, { pageUrl: finalUrl });
  const jobs = Object.freeze([
    ...new Map(
      [...genericJobs, ...dynamicJobs]
        .map((job) => [job.jobDetailUrl || job.sourceUrl, job]),
    ).values(),
  ]);
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
    jobs,
    extractionAdapters: Object.freeze([
      ...new Set(dynamicJobs.map((job) => job.extractionAdapter).filter(Boolean)),
    ]),
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
