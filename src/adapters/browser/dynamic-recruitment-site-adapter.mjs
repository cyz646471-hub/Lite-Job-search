const ADAPTERS = Object.freeze([
  {
    id: 'MOKA',
    host: /(?:^|\.)(?:mokahr\.com|mokahr\.cn)$/i,
    detail: /\/(?:jobs?|positions?|job|position)\/[^/?#]+|\/job\/[^/?#]+/i,
  },
  {
    id: 'HOTJOB',
    host: /(?:^|\.)hotjob\.cn$/i,
    detail: /\/(?:job|position)(?:\/|[?][^#]*(?:id|jobid)=)/i,
  },
  {
    id: 'ZHIYE',
    host: /(?:^|\.)zhiye\.com$/i,
    detail: /\/(?:job|position)(?:\/|[?][^#]*(?:id|jobid)=)/i,
  },
  {
    id: 'WORKDAY',
    host: /(?:^|\.)myworkdayjobs\.com$/i,
    detail: /\/job\/[^/?#]+/i,
  },
  {
    id: 'GREENHOUSE',
    host: /(?:^|\.)greenhouse\.io$/i,
    detail: /\/jobs\/\d+/i,
  },
  {
    id: 'SMARTRECRUITERS',
    host: /(?:^|\.)smartrecruiters\.com$/i,
    detail: /\/[^/]+\/\d+-[^/?#]+/i,
  },
]);

const NAVIGATION_TEXT = /^(?:职位|岗位|招聘|查看职位|职位详情|申请|投递|jobs?|careers?|apply(?: now)?|view job)$/i;

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function adapterFor(url) {
  try {
    const parsed = new URL(String(url || ''));
    return ADAPTERS.find((adapter) => adapter.host.test(parsed.hostname)) || null;
  } catch {
    return null;
  }
}

function sourceJobId(url) {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(
      parsed.pathname.match(/\/(?:jobs?|positions?|job|position)\/([^/?#]+)/i)?.[1]
      || parsed.searchParams.get('jobId')
      || parsed.searchParams.get('id')
      || '',
    ) || null;
  } catch {
    return null;
  }
}

export function extractDynamicRecruitmentJobs(snapshot = {}, {
  pageUrl = '',
} = {}) {
  const pageAdapter = adapterFor(pageUrl);
  const jobs = [];
  const seen = new Set();
  for (const link of snapshot.links || []) {
    const href = clean(link?.href);
    const adapter = adapterFor(href) || pageAdapter;
    const title = clean(link?.text).split(/\s+(?:职位\s*ID|Position\s*ID)\b/i)[0];
    if (!adapter || !href || !adapter.detail.test(href)
      || !title || title.length > 160 || NAVIGATION_TEXT.test(title)) {
      continue;
    }
    const key = `${adapter.id}|${href}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const job = {
      title,
      jobDetailUrl: href,
      sourceUrl: href,
      status: 'ACTIVE',
      extractionAdapter: adapter.id,
    };
    const id = sourceJobId(href);
    if (id) job.sourceJobId = id;
    jobs.push(Object.freeze(job));
  }
  return Object.freeze(jobs);
}
