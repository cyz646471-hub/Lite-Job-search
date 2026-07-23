import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson } from './storage.mjs';
import { inferJobBucket } from './job-bucket.mjs';
import { sourceForUrl } from './cn-source-catalog.mjs';
import { classifyRecruitmentUrl, isOfficialApplyChannel } from './official-links.mjs';
import { aggregateCnRecruitmentProjects, canonicalCnCompany, inferRecruitmentBatch, recruitmentProjectKey, sourceTrust } from './cn-recruitment-project.mjs';
import { resolveCompanyName } from './cn-company-resolver.mjs';

function clean(value) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function canonical(value) { return clean(value).toLowerCase().replace(/[\s·•（）()\-_—–|｜/\\.,，。:：]+/g, ''); }
export function inferCohortYear(record = {}) {
  const explicit = Number(record.cohortYear);
  if (explicit >= 2020 && explicit <= 2100) return explicit;
  const match = `${record.title || ''} ${record.batchName || ''} ${record.description || record.snippet || ''}`.match(/(?:20)?(2[0-9])届/);
  if (match) return 2000 + Number(match[1]);
  if (classifyCnRecordScope(record) === 'social') return null;
  // When a campus/internship source omits the target cohort, the opening year
  // deterministically maps to the next graduating class. This removes the
  // ambiguous "unknown cohort" bucket while keeping the inference auditable.
  const openingAt = Number(record.campaignStartAt || record.postedAt || record.updateTime || record.firstSeenAt || 0);
  if (!openingAt) return null;
  const openingYear = new Date(openingAt).getUTCFullYear();
  return openingYear >= 2020 && openingYear <= 2099 ? openingYear + 1 : null;
}

export function classifyCnRecordScope(record = {}) {
  const title = `${record.title || ''} ${record.batchName || ''}`;
  const blob = `${title} ${record.description || record.snippet || ''}`;
  // Platform recruit-type fields are occasionally inconsistent with the visible title.
  // Strong visible campaign semantics therefore win before provider metadata.
  if (/实习|intern/i.test(title)) return 'internship';
  if (/社招|社会招聘|经验招聘|experienced/i.test(title)) return 'social';
  if (/(?:20)?2[0-9]届|校招|校园招聘|应届|秋招|春招/i.test(title)) return 'campus';
  if (['internship', 'campus', 'social'].includes(record.scope)) return record.scope;
  if (record.jobType === 'internship' || /实习|intern/i.test(blob)) return 'internship';
  if (record.jobBucket === 'experienced' || /社招|社会招聘|经验招聘|experienced/i.test(blob)) return 'social';
  if (record.jobType === 'new_grad_full_time' || record.cohortYear || /校招|校园招聘|应届|秋招|春招/i.test(blob)) return 'campus';
  return inferJobBucket(record) === 'experienced' ? 'social' : 'campus';
}

export function databaseBucketForRecord(record = {}) {
  const cohortYear = inferCohortYear(record);
  if (cohortYear) return `cohort-${cohortYear}`;
  const scope = classifyCnRecordScope(record);
  if (scope === 'internship') return 'daily-internships';
  if (scope === 'social') return 'social';
  return 'cohort-unknown';
}

function recordKey(record) {
  const identity = [record.company, record.title || record.batchName, record.location, record.cohortYear || '', record.batchName || ''].map(canonical).join('|');
  return createHash('sha1').update(identity).digest('hex').slice(0, 24);
}

function collectLinks(record) {
  const pairs = [
    [record.finalApplyUrl, '最终投递入口', 'apply'], [record.applyUrl, record.source, 'apply'], [record.announcementUrl, record.source, 'detail'],
    [record.detailUrl, record.source, 'detail'], [record.url, record.source, 'source'], [record.officialUrl, '官方入口', 'apply'],
    [record.indexUrl, record.source, 'source'], [record.sourceUrl, record.source, 'source'],
    ...(record.sourceLinks || []).map((link) => [link?.url, link?.source, link?.linkType || (isOfficialApplyChannel(classifyRecruitmentUrl(link?.url).channel) ? 'apply' : 'source')]),
  ];
  const seen = new Set();
  return pairs.filter(([url]) => /^https?:\/\//i.test(String(url || ''))).map(([url, source, linkType]) => ({ url: String(url), source: clean(source) || sourceForUrl(url).name, linkType })).filter((item) => !seen.has(item.url) && seen.add(item.url));
}

function linkRank(link, scope) {
  const official = classifyRecruitmentUrl(link.url).rank;
  if (official >= 3) return 100 + official;
  const id = sourceForUrl(link.url).id;
  const order = scope === 'internship' ? ['shixiseng', 'nowcoder', 'boss', 'liepin'] : scope === 'social' ? ['liepin', 'boss', 'zhaopin', 'nowcoder'] : ['nowcoder', 'boss', 'yingjiesheng', 'ncss'];
  const index = order.indexOf(id);
  return index < 0 ? 1 : 50 - index;
}

export function normalizeDatabaseRecord(record = {}, { now = Date.now(), runId = String(now) } = {}) {
  const scope = classifyCnRecordScope(record);
  const links = collectLinks(record).sort((a, b) => linkRank(b, scope) - linkRank(a, scope));
  const title = clean(record.title || record.batchName || '招聘项目');
  const recruitmentType = inferRecruitmentBatch({ ...record, scope });
  const company = resolveCompanyName(record.company);
  const governedLinks = record.recruitmentLinks || null;
  const governedOfficialLink = clean(governedLinks?.applyUrl || governedLinks?.campaignAnnouncementUrl || governedLinks?.companyCareerHomeUrl);
  // New governance records are deliberately allowed to have no accepted official
  // URL. Legacy records retain the previous normalisation path for compatibility.
  const officialLink = governedLinks?.enforced ? governedOfficialLink : (governedOfficialLink || links.find((item) => isOfficialApplyChannel(classifyRecruitmentUrl(item.url).channel))?.url || '');
  const normalized = {
    id: '', recordType: record.recordType === 'recruitment_campaign' ? '招聘项目' : '岗位',
    company: company.canonicalName || clean(record.company), companyRawName: record.companyRawName || company.rawName, companyCleanName: clean(record.companyCleanName || company.canonicalName || record.company), companyStandardId: company.companyId || canonicalCnCompany(record.company), companyMatchMethod: company.matchedBy, companyMatchConfidence: company.confidence, organizationType: clean(record.organizationType) || '待确认', title,
    batchName: clean(record.batchName), location: clean(record.location), scope,
    jobType: scope === 'internship' ? 'internship' : scope === 'campus' ? 'new_grad_full_time' : 'unspecified_full_time', cohortYear: governedLinks ? (record.cohortYear || null) : inferCohortYear(record), graduationYears: Array.isArray(record.graduationYears) ? record.graduationYears : [], graduationYearRaw: clean(record.graduationYearRaw), audienceType: clean(record.audienceType) || 'unknown',
    postedAt: Number(record.postedAt || record.campaignStartAt || record.updateTime || record.discoveredAt) || null,
    expiresAt: Number(record.expiresAt) || null, firstSeenAt: Number(record.firstSeenAt) || now, lastSeenAt: now,
    firstRunId: runId, lastRunId: runId, newInRun: true, seenCount: 1,
    primaryUrl: officialLink || '', officialUrl: officialLink || '', finalApplyUrl: clean(governedLinks?.applyUrl || record.finalApplyUrl), announcementUrl: clean(governedLinks?.campaignAnnouncementUrl || record.announcementUrl), detailUrl: clean(governedLinks?.campaignAnnouncementUrl || record.detailUrl), recruitmentLinks: governedLinks || null,
    source: clean(record.source), sourceType: clean(record.sourceType) || 'aggregator', sources: [...new Set(links.map((item) => item.source).filter(Boolean))], sourceLinks: links,
    recruitmentType, campaignYear: Number(record.campaignYear) || new Date(Number(record.campaignStartAt || record.postedAt || now)).getUTCFullYear(), projectId: recruitmentProjectKey({ ...record, scope, cohortYear: inferCohortYear(record) }),
    officialVerified: record.officialVerified === true || record.sourceType === 'official_company' || record.sourceType === 'official_ats',
    reachable: record.reachable === true, officialCandidateFound: record.officialCandidateFound === true, officialIdentityConfirmed: record.officialIdentityConfirmed === true || record.sourceType === 'official_company', campaignConfirmed: record.campaignConfirmed === true || record.sourceType === 'official_company', applicationActive: typeof record.applicationActive === 'boolean' ? record.applicationActive : null,
    verificationStatus: clean(record.verificationStatus) || (record.sourceType === 'official_company' ? 'verified' : 'discovered'), verificationState: clean(record.verificationState) || (record.sourceType === 'official_company' ? 'VERIFIED' : 'UNVERIFIED'),
    verificationReason: clean(record.verificationReason), verificationCheckedAt: Number(record.verificationCheckedAt || record.lastVerifiedAt) || null,
    searchStatus: clean(record.searchStatus), searchDeferredByBudgetAt: Number(record.searchDeferredByBudgetAt) || null,
    ats: clean(record.ats), redirectChain: Array.isArray(record.redirectChain) ? record.redirectChain : [], verification: record.verification || null, staleOrExpired: record.staleOrExpired === true, deadlineType: clean(record.deadlineType) || (record.expiresAt ? 'exact' : 'unknown'), positions: Array.isArray(record.positions) ? record.positions : [], majors: Array.isArray(record.majors) ? record.majors : [], requirements: Array.isArray(record.requirements) ? record.requirements : [], positionsIncomplete: record.positionsIncomplete === true, campaignSources: Array.isArray(record.campaignSources) ? record.campaignSources : [], officialLinkGovernedAt: Number(record.officialLinkGovernedAt) || null,
    description: clean(record.description || record.snippet || record.responsibilities).slice(0, 30000),
    status: clean(record.livenessStatus || (record.officialVerified ? 'active' : '待官网验证')),
  };
  normalized.id = recordKey(normalized);
  return normalized;
}

function mergeRecord(existing, incoming, runId, now) {
  const links = [...(existing.sourceLinks || []), ...(incoming.sourceLinks || [])];
  const seen = new Set();
  const sourceLinks = links.filter((item) => item?.url && !seen.has(item.url) && seen.add(item.url)).sort((a, b) => linkRank(b, incoming.scope) - linkRank(a, incoming.scope));
  const incomingVerificationIsCurrent = Number(incoming.verificationCheckedAt || 0) > 0 && Number(incoming.verificationCheckedAt || 0) >= Number(existing.verificationCheckedAt || 0);
  return {
    ...existing,
    scope: incoming.scope, jobType: incoming.jobType,
    organizationType: existing.organizationType === '待确认' ? incoming.organizationType : existing.organizationType,
    location: existing.location || incoming.location, batchName: existing.batchName || incoming.batchName,
    cohortYear: existing.cohortYear || incoming.cohortYear, postedAt: Math.max(Number(existing.postedAt || 0), Number(incoming.postedAt || 0)) || null,
    expiresAt: Math.max(Number(existing.expiresAt || 0), Number(incoming.expiresAt || 0)) || null,
    description: (incoming.description || '').length > (existing.description || '').length ? incoming.description : existing.description,
    primaryUrl: incoming.officialVerified ? (incoming.primaryUrl || existing.primaryUrl) : (existing.primaryUrl || incoming.primaryUrl || ''),
    officialUrl: incoming.officialVerified ? (incoming.officialUrl || existing.officialUrl) : (existing.officialUrl || incoming.officialUrl),
    finalApplyUrl: incoming.finalApplyUrl || existing.finalApplyUrl || '', announcementUrl: incoming.announcementUrl || existing.announcementUrl || '', detailUrl: incoming.detailUrl || existing.detailUrl || '', projectId: existing.projectId || incoming.projectId,
    recruitmentLinks: incoming.recruitmentLinks || existing.recruitmentLinks || null, graduationYears: incoming.graduationYears?.length ? incoming.graduationYears : (existing.graduationYears || []), graduationYearRaw: incoming.graduationYearRaw || existing.graduationYearRaw || '', audienceType: incoming.audienceType || existing.audienceType || 'unknown', companyRawName: existing.companyRawName || incoming.companyRawName || '', companyCleanName: incoming.companyCleanName || existing.companyCleanName || '',
    recruitmentType: existing.recruitmentType || incoming.recruitmentType, companyStandardId: existing.companyStandardId || incoming.companyStandardId,
    officialVerified: incomingVerificationIsCurrent ? incoming.officialVerified === true : Boolean(existing.officialVerified || incoming.officialVerified),
    reachable: incomingVerificationIsCurrent ? incoming.reachable === true : Boolean(existing.reachable || incoming.reachable), officialCandidateFound: incomingVerificationIsCurrent ? incoming.officialCandidateFound === true : Boolean(existing.officialCandidateFound || incoming.officialCandidateFound), officialIdentityConfirmed: incomingVerificationIsCurrent ? incoming.officialIdentityConfirmed === true : Boolean(existing.officialIdentityConfirmed || incoming.officialIdentityConfirmed), campaignConfirmed: incomingVerificationIsCurrent ? incoming.campaignConfirmed === true : Boolean(existing.campaignConfirmed || incoming.campaignConfirmed), applicationActive: incomingVerificationIsCurrent ? incoming.applicationActive : (typeof incoming.applicationActive === 'boolean' ? incoming.applicationActive : existing.applicationActive),
    verificationStatus: incomingVerificationIsCurrent ? incoming.verificationStatus : (incoming.officialVerified ? incoming.verificationStatus : (existing.verificationStatus || incoming.verificationStatus)),
    verificationState: incomingVerificationIsCurrent ? incoming.verificationState : (incoming.officialVerified ? (incoming.verificationState || 'VERIFIED') : (existing.verificationState || incoming.verificationState || 'UNVERIFIED')),
    verificationReason: incomingVerificationIsCurrent ? incoming.verificationReason : (incoming.officialVerified ? incoming.verificationReason : (existing.verificationReason || incoming.verificationReason)),
    verificationCheckedAt: Math.max(Number(existing.verificationCheckedAt || 0), Number(incoming.verificationCheckedAt || 0)) || null,
    searchStatus: incoming.searchStatus || existing.searchStatus || '', searchDeferredByBudgetAt: Number(incoming.searchDeferredByBudgetAt || existing.searchDeferredByBudgetAt || 0) || null,
    ats: incoming.ats || existing.ats || '', redirectChain: incoming.redirectChain?.length ? incoming.redirectChain : (existing.redirectChain || []), verification: incoming.verification || existing.verification || null, staleOrExpired: incoming.staleOrExpired === true || existing.staleOrExpired === true, deadlineType: incoming.deadlineType || existing.deadlineType || 'unknown', positions: incoming.positions?.length ? incoming.positions : (existing.positions || []), majors: incoming.majors?.length ? incoming.majors : (existing.majors || []), requirements: incoming.requirements?.length ? incoming.requirements : (existing.requirements || []), positionsIncomplete: incoming.positionsIncomplete === true || existing.positionsIncomplete === true, campaignSources: incoming.campaignSources?.length ? incoming.campaignSources : (existing.campaignSources || []), officialLinkGovernedAt: Number(incoming.officialLinkGovernedAt || existing.officialLinkGovernedAt || 0) || null,
    sources: [...new Set(sourceLinks.map((item) => item.source).filter(Boolean))], sourceLinks,
    lastSeenAt: now, lastRunId: runId, newInRun: false, seenCount: Number(existing.seenCount || 1) + 1,
  };
}

export function auditCnDatabase(records = [], { now = Date.now() } = {}) {
  const anomalies = [];
  const ids = new Set();
  for (const record of records) {
    if (!record.company) anomalies.push({ id: record.id, type: 'missing_company', title: record.title });
    if (!record.title) anomalies.push({ id: record.id, type: 'missing_title', company: record.company });
    if (!record.primaryUrl && !(record.sourceLinks || []).length) anomalies.push({ id: record.id, type: 'missing_url', company: record.company, title: record.title });
    if (record.postedAt && record.postedAt > now + 86_400_000) anomalies.push({ id: record.id, type: 'future_posted_at', postedAt: record.postedAt });
    if (ids.has(record.id)) anomalies.push({ id: record.id, type: 'duplicate_id' });
    ids.add(record.id);
    if (record.scope === 'campus' && !record.cohortYear) anomalies.push({ id: record.id, type: 'campus_cohort_unknown', company: record.company, title: record.title });
  }
  return anomalies;
}

export async function updateCnJobDatabases({ rootDir, records = [], cohorts = [2027, 2028], runId = new Date().toISOString(), now = Date.now() } = {}) {
  const databaseDir = path.join(rootDir, 'data', 'cn-job-database');
  const normalized = records.map((record) => normalizeDatabaseRecord(record, { now, runId })).filter((record) => record.company || record.title);
  const buckets = new Map();
  for (const record of normalized) {
    const bucket = databaseBucketForRecord(record);
    if (!buckets.has(bucket)) buckets.set(bucket, []);
    buckets.get(bucket).push(record);
  }
  const updatedRecords = [];
  const files = [];
  for (const [bucket, incoming] of buckets) {
    const file = path.join(databaseDir, `${bucket}.json`);
    const database = await readJson(file, { version: 1, bucket, createdAt: runId, updatedAt: runId, records: [] });
    const map = new Map((database.records || []).map((record) => [record.id, { ...record, newInRun: false }]));
    for (const record of incoming) map.set(record.id, map.has(record.id) ? mergeRecord(map.get(record.id), record, runId, now) : record);
    const all = [...map.values()].sort((a, b) => Number(b.postedAt || b.firstSeenAt || 0) - Number(a.postedAt || a.firstSeenAt || 0));
    const next = { ...database, version: 1, bucket, updatedAt: runId, recordCount: all.length, records: all };
    await writeJson(file, next);
    files.push(file);
    updatedRecords.push(...all);
  }
  for (const cohort of cohorts) {
    const file = path.join(databaseDir, `cohort-${cohort}.json`);
    if (!(await readJson(file, null))) { await writeJson(file, { version: 1, bucket: `cohort-${cohort}`, createdAt: runId, updatedAt: runId, recordCount: 0, records: [] }); files.push(file); }
  }
  // Rebucket the complete store on every run. This repairs records when a source fixes
  // its type/cohort metadata and prevents stale copies from remaining in an old file.
  const databaseNames = (await readdir(databaseDir)).filter((name) => name.endsWith('.json') && name !== 'anomalies.json');
  const canonicalRecords = new Map();
  for (const name of databaseNames) {
    const database = await readJson(path.join(databaseDir, name), { records: [] });
    for (const record of database.records || []) {
      const prior = canonicalRecords.get(record.id);
      if (!prior || Number(record.lastSeenAt || 0) >= Number(prior.lastSeenAt || 0)) canonicalRecords.set(record.id, record);
    }
  }
  const regrouped = new Map();
  for (const record of canonicalRecords.values()) {
    const repaired = { ...record, newInRun: record.firstRunId === runId };
    const bucket = databaseBucketForRecord(repaired);
    if (!regrouped.has(bucket)) regrouped.set(bucket, []);
    regrouped.get(bucket).push(repaired);
  }
  const bucketNames = new Set([
    ...databaseNames.map((name) => name.replace(/\.json$/i, '')),
    ...regrouped.keys(),
    ...cohorts.map((cohort) => `cohort-${cohort}`),
    'cohort-unknown', 'daily-internships', 'social',
  ]);
  for (const bucket of bucketNames) {
    const file = path.join(databaseDir, `${bucket}.json`);
    const prior = await readJson(file, { version: 1, bucket, createdAt: runId });
    const bucketRecords = (regrouped.get(bucket) || []).sort((a, b) => Number(b.postedAt || b.firstSeenAt || 0) - Number(a.postedAt || a.firstSeenAt || 0));
    await writeJson(file, { ...prior, version: 1, bucket, updatedAt: runId, recordCount: bucketRecords.length, records: bucketRecords });
    files.push(file);
  }
  const dedupedRecords = [...canonicalRecords.values()].map((record) => ({ ...record, newInRun: record.firstRunId === runId }));
  const anomalies = auditCnDatabase(dedupedRecords, { now });
  await writeJson(path.join(databaseDir, 'anomalies.json'), { runId, checkedAt: now, count: anomalies.length, anomalies });
  return { databaseDir, runId, records: dedupedRecords, newRecords: dedupedRecords.filter((record) => record.lastRunId === runId && record.firstRunId === runId), anomalies, files: [...new Set(files)] };
}

export function selectDatabaseOutput(records = [], { mode = 'window', scope = 'all', sinceDays = 30, cohorts = [], runId, now = Date.now() } = {}) {
  const cutoff = now - Math.max(1, Number(sinceDays) || 30) * 86_400_000;
  const filtered = records.filter((record) => {
    const links = record.sourceLinks || [];
    const legacyNowcoderOnly = links.length > 0
      && links.every((link) => /nowcoder\.com\/jobs\/detail\//i.test(String(link.url || '')))
      && !(record.sources || []).some((source) => /NowCoder Schedule/i.test(String(source)));
    if (legacyNowcoderOnly) return false;
    if (cohorts.length && record.cohortYear && !cohorts.includes(Number(record.cohortYear))) return false;
    if (scope !== 'all' && record.scope !== scope) return false;
    if (mode === 'new') return record.firstRunId === runId;
    if (mode === 'scope') return true;
    return Number(record.postedAt || record.firstSeenAt || 0) >= cutoff;
  });
  // The presentation unit is one employer recruitment project, not one job
  // card. Job details remain attached as `jobDetails` for audit and drilldown.
  return aggregateCnRecruitmentProjects(filtered);
}
