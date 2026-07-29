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
    id: 'BEISEN',
    host: /(?:^|\.)(?:beisen\.com|beisencloud\.com|italent\.cn)$/i,
    detail: /\/(?:job|position|detail)(?:\/|[?][^#]*(?:id|jobid|positionid)=)/i,
  },
  {
    id: 'FEISHU_RECRUITMENT',
    host: /(?:^|\.)(?:jobs\.feishu\.cn|jobs\.bytedance\.com)$/i,
    detail: /\/(?:job|position)\/[^/?#]+|[?][^#]*(?:jobid|positionid)=/i,
  },
  {
    id: 'TALENTCLUE',
    host: /(?:^|\.)talentclue\.com$/i,
    detail: /\/(?:job|position|detail)(?:\/|[?][^#]*(?:id|jobid)=)/i,
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

function absoluteUrl(value, pageUrl) {
  try {
    return new URL(String(value || ''), pageUrl).href;
  } catch {
    return null;
  }
}

function locationsOf(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  if (typeof value === 'object' && value) {
    return [value.addressLocality, value.addressRegion, value.name].map(clean).filter(Boolean);
  }
  return clean(value).split(/[、，,|]/).map(clean).filter(Boolean);
}

function structuredJob(record, pageUrl) {
  if (!record || typeof record !== 'object') return null;
  const type = clean(record['@type']).toLowerCase();
  const title = clean(record.title || record.jobTitle || record.jobName || record.positionName || record.name);
  const identifier = record.identifier?.value || record.identifier || record.jobId || record.positionId || record.id;
  const detailUrl = absoluteUrl(record.url || record.jobUrl || record.detailUrl || record.applyUrl, pageUrl);
  const jobShape = type === 'jobposting'
    || Boolean(record.jobTitle || record.jobName || record.positionName)
    || Boolean(identifier && detailUrl);
  if (!jobShape || !title || title.length > 160) return null;
  const job = {
    title,
    jobDetailUrl: detailUrl || pageUrl,
    sourceUrl: detailUrl || pageUrl,
    status: 'ACTIVE',
    extractionAdapter: type === 'jobposting' ? 'JSON_LD_JOB_POSTING' : 'EMBEDDED_JSON_JOB',
  };
  if (identifier) job.sourceJobId = clean(identifier);
  const locations = locationsOf(
    record.jobLocation?.address
    || record.jobLocation
    || record.locations
    || record.location
    || record.cityName,
  );
  if (locations.length) job.locations = locations;
  if (record.datePosted || record.publishedAt || record.postedAt) {
    job.publishedAt = record.datePosted || record.publishedAt || record.postedAt;
  }
  if (record.validThrough || record.closesAt || record.expiresAt) {
    job.closesAt = record.validThrough || record.closesAt || record.expiresAt;
  }
  if (record.employmentType || record.jobType) job.employmentType = record.employmentType || record.jobType;
  if (record.applyUrl || record.applicationUrl) {
    job.applyUrl = absoluteUrl(record.applyUrl || record.applicationUrl, pageUrl);
  }
  return job;
}

function embeddedJsonPayloads(html = '') {
  const values = [];
  const pattern = /<script\b[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) && values.length < 30) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      // Malformed analytics or hydration JSON is not job evidence.
    }
  }
  return values;
}

function jobsFromEmbeddedJson(snapshot, pageUrl) {
  const jobs = [];
  const queue = [...embeddedJsonPayloads(snapshot.html)];
  let visited = 0;
  while (queue.length && visited < 5_000) {
    const value = queue.shift();
    visited += 1;
    if (Array.isArray(value)) {
      queue.push(...value);
      continue;
    }
    if (!value || typeof value !== 'object') continue;
    const job = structuredJob(value, pageUrl);
    if (job) jobs.push(job);
    queue.push(...Object.values(value).filter((item) => item && typeof item === 'object'));
  }
  return jobs;
}

export function extractDynamicRecruitmentJobs(snapshot = {}, {
  pageUrl = '',
} = {}) {
  const pageAdapter = adapterFor(pageUrl);
  const jobs = [];
  const seen = new Set();
  for (const job of [
    ...(snapshot.structuredJobs || []).map((record) => structuredJob(record, pageUrl)),
    ...jobsFromEmbeddedJson(snapshot, pageUrl),
  ].filter(Boolean)) {
    const key = `${job.sourceJobId || ''}|${job.jobDetailUrl}|${job.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(Object.freeze(job));
  }
  for (const link of snapshot.links || []) {
    const href = clean(link?.href);
    const adapter = adapterFor(href) || pageAdapter;
    const title = clean(link?.text).split(/\s+(?:职位\s*ID|Position\s*ID)\b/i)[0];
    if (!adapter || !href || !adapter.detail.test(href)
      || !title || title.length > 160 || NAVIGATION_TEXT.test(title)) {
      continue;
    }
    const key = `${adapter.id}|${href}|${title}`;
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
