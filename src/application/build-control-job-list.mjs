const ALLOWED_SOURCE_TIERS = new Set([
  'ALL',
  'OFFICIAL_SITE',
  'OFFICIAL_ATS',
  'OFFICIAL_SOCIAL',
  'PLATFORM_ONLY',
]);
const ALLOWED_JOB_STATUSES = new Set(['ALL', 'ACTIVE', 'CLOSED', 'UNKNOWN']);
const ALLOWED_QUALITY_GRADES = new Set(['ALL', 'A', 'B', 'C', 'C_POSITIVE']);
const ALLOWED_PUBLICATION_STATUSES = new Set([
  'ALL',
  'PUBLISHED',
  'REVIEW_REQUIRED',
  'CANDIDATE',
  'REJECTED',
]);

function selected(value, allowed, fallback = 'ALL') {
  const normalized = String(value || fallback).toUpperCase();
  return allowed.has(normalized) ? normalized : fallback;
}

function normalized(value) {
  return String(value || '').normalize('NFKC').trim().toLowerCase();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function officialActionUrl({ job, event, portal }) {
  if (
    portal?.verificationStatus !== 'VERIFIED'
    || portal?.officialIdentityConfirmed !== true
    || !['OFFICIAL_SITE', 'OFFICIAL_ATS', 'OFFICIAL_SOCIAL'].includes(job.sourceTier)
    || job.status !== 'ACTIVE'
    || job.qualityGrade !== 'A'
    || job.publicationStatus !== 'PUBLISHED'
  ) return null;
  return [
    job.applyUrl,
    job.jobDetailUrl,
    event?.directoryUrl,
    portal.canonicalUrl,
  ].map(safeHttpUrl).find(Boolean) || null;
}

export function buildControlJobList({
  repository,
  query = '',
  sourceTier = 'ALL',
  jobStatus = 'ALL',
  publicationStatus = 'ALL',
  qualityGrade = 'ALL',
  groupBy = 'JOB',
  offset = 0,
  limit = 50,
} = {}) {
  if (!repository) throw new Error('repository is required');
  const companies = repository.listCompanies();
  const portals = repository.listCareerPortals();
  const events = repository.listRecruitmentEvents();
  const jobs = repository.listJobOpenings();
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const portalById = new Map(portals.map((portal) => [portal.id, portal]));
  const eventById = new Map(events.map((event) => [event.id, event]));
  const selectedSourceTier = selected(sourceTier, ALLOWED_SOURCE_TIERS);
  const selectedJobStatus = selected(jobStatus, ALLOWED_JOB_STATUSES);
  const selectedPublicationStatus = selected(
    publicationStatus,
    ALLOWED_PUBLICATION_STATUSES,
  );
  const selectedQualityGrade = selected(qualityGrade, ALLOWED_QUALITY_GRADES);
  const selectedOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const selectedLimit = Math.max(1, Math.min(200, Math.trunc(Number(limit) || 50)));
  const needle = normalized(query);

  const rows = jobs.map((job) => {
    const company = companyById.get(job.companyId);
    const portal = portalById.get(job.careerPortalId);
    const event = eventById.get(job.recruitmentEventId);
    const actionUrl = officialActionUrl({ job, event, portal });
    return {
      id: job.id,
      companyId: company?.id || job.companyId,
      company: company?.canonicalName || job.companyId,
      title: job.title,
      roleFamily: job.roleFamily || null,
      locations: job.locations || [],
      employmentType: job.employmentType || null,
      publishedAt: job.publishedAt || null,
      closesAt: job.closesAt || event?.closesAt || null,
      jobStatus: job.status,
      sourceTier: job.sourceTier,
      qualityGrade: job.qualityGrade,
      publicationStatus: job.publicationStatus,
      recruitmentType: event?.recruitmentType || null,
      cohort: event?.cohort || null,
      campaignName: event?.campaignName || null,
      portalStatus: portal?.verificationStatus || null,
      portalPageType: portal?.pageType || null,
      confidenceScore: portal?.confidenceScore ?? null,
      actionUrl,
      actionKind: actionUrl ? 'OFFICIAL_ACTION' : null,
      sourceUrl: safeHttpUrl(job.sourceUrl || portal?.canonicalUrl),
      lastSeenAt: job.lastSeenAt || null,
    };
  }).filter((row) => {
    if (selectedSourceTier !== 'ALL' && row.sourceTier !== selectedSourceTier) return false;
    if (selectedJobStatus !== 'ALL' && row.jobStatus !== selectedJobStatus) return false;
    if (
      selectedPublicationStatus !== 'ALL'
      && row.publicationStatus !== selectedPublicationStatus
    ) return false;
    if (
      selectedQualityGrade === 'C_POSITIVE'
      && !(row.qualityGrade === 'C' && Number(row.confidenceScore) > 0)
    ) return false;
    if (
      !['ALL', 'C_POSITIVE'].includes(selectedQualityGrade)
      && row.qualityGrade !== selectedQualityGrade
    ) return false;
    if (!needle) return true;
    return [
      row.company,
      row.title,
      row.roleFamily,
      row.locations.join(' '),
      row.recruitmentType,
      row.cohort,
      row.campaignName,
    ].some((value) => normalized(value).includes(needle));
  }).sort((left, right) => (
    Number(Boolean(right.actionUrl)) - Number(Boolean(left.actionUrl))
    || String(left.company).localeCompare(String(right.company), 'zh-CN')
    || String(left.title).localeCompare(String(right.title), 'zh-CN')
  ));

  const selectedGroupBy = String(groupBy || 'JOB').toUpperCase() === 'COMPANY'
    ? 'COMPANY'
    : 'JOB';
  const companyGroups = new Map();
  for (const row of rows) {
    const current = companyGroups.get(row.companyId) || {
      id: row.companyId,
      company: row.company,
      jobs: [],
    };
    current.jobs.push(row);
    companyGroups.set(row.companyId, current);
  }
  const groupedRows = [...companyGroups.values()].map((group) => {
    const unique = (values) => [...new Set(values.filter(Boolean))];
    const publishedDates = group.jobs.map((job) => job.publishedAt).filter(Boolean).sort();
    const closingDates = group.jobs.map((job) => job.closesAt).filter(Boolean).sort();
    return Object.freeze({
      id: group.id,
      company: group.company,
      jobCount: group.jobs.length,
      actionableCount: group.jobs.filter((job) => job.actionUrl).length,
      reviewRequiredCount: group.jobs.filter(
        (job) => job.publicationStatus === 'REVIEW_REQUIRED',
      ).length,
      platformOnlyCount: group.jobs.filter((job) => job.sourceTier === 'PLATFORM_ONLY').length,
      locations: Object.freeze(unique(group.jobs.flatMap((job) => job.locations))),
      cohorts: Object.freeze(unique(group.jobs.map((job) => job.cohort))),
      campaignNames: Object.freeze(unique(group.jobs.map((job) => job.campaignName))),
      recruitmentTypes: Object.freeze(unique(group.jobs.map((job) => job.recruitmentType))),
      qualityGrades: Object.freeze(unique(group.jobs.map((job) => job.qualityGrade))),
      sourceTiers: Object.freeze(unique(group.jobs.map((job) => job.sourceTier))),
      portalStatuses: Object.freeze(unique(group.jobs.map((job) => job.portalStatus))),
      publishedFrom: publishedDates.at(0) || null,
      publishedTo: publishedDates.at(-1) || null,
      closesFrom: closingDates.at(0) || null,
      closesTo: closingDates.at(-1) || null,
      jobs: Object.freeze(group.jobs.map((job) => Object.freeze(job))),
    });
  }).sort((left, right) => (
    right.actionableCount - left.actionableCount
    || left.company.localeCompare(right.company, 'zh-CN')
  ));
  const selectedRows = selectedGroupBy === 'COMPANY' ? groupedRows : rows;
  const page = selectedRows.slice(selectedOffset, selectedOffset + selectedLimit);
  return Object.freeze({
    status: 'OK',
    generatedAt: new Date().toISOString(),
    query: String(query || ''),
    sourceTier: selectedSourceTier,
    jobStatus: selectedJobStatus,
    publicationStatus: selectedPublicationStatus,
    qualityGrade: selectedQualityGrade,
    groupBy: selectedGroupBy,
    offset: selectedOffset,
    limit: selectedLimit,
    total: selectedRows.length,
    jobTotal: rows.length,
    companyTotal: groupedRows.length,
    counts: Object.freeze({
      actionable: rows.filter((row) => row.actionUrl).length,
      published: rows.filter((row) => row.publicationStatus === 'PUBLISHED').length,
      reviewRequired: rows.filter((row) => row.publicationStatus === 'REVIEW_REQUIRED').length,
      platformOnly: rows.filter((row) => row.sourceTier === 'PLATFORM_ONLY').length,
    }),
    items: Object.freeze(page.map((row) => Object.freeze(row))),
  });
}
