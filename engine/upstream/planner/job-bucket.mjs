// Job-bucketing layer for the jobseeker-facing surface. Three top-level
// buckets collapse the upstream fine-grained jobType taxonomy so a
// candidate can filter the workbook in a single click.
//
//   internship    summer / spring / co-op / intern
//   full_time     new_grad / early_career / unspecified_full_time without
//                 senior/lead/staff/principal aliases
//   experienced   senior / staff / principal / lead / director (and any role
//                 that requires 3+ years of experience)
//
// Bucket overrides take precedence over the underlying jobType so a
// "Senior iOS Engineer" listing labelled `new_grad_full_time` by a
// coarse provider still lands in the experienced bucket.

const BUCKETS = ['internship', 'full_time', 'experienced'];

const SENIOR_TITLE_RE = /\\b(?:senior|sr\.?|staff|principal|lead|manager|director|expert|head of|architect)\b|engineer\\s+(?:ii|iii|iv)\b/i;
const INTERN_TITLE_RE = /\\b(?:intern|co-?op)\b|\u5b9e\u4e60|\u5b9e\u4e60\u751f|\u6691\u671f\u5b9e\u4e60|\u4ee3\u62db\u5b9e\u4e60/i;
const FRESH_GRAD_TITLE_RE = /\b(?:new grad|graduate|newly graduated|0[\s\-]?(?:to[\s\-]?1|1)[\s\-]?year|class of)\b|\u5e94\u5c4a\u751f|\u6821\u62db|\u9ad8\u6821|\u6821\u5f55\u53d6/i;

const BUCKET_LABEL = {
  internship: '\u5b9e\u4e60',
  full_time: '\u5168\u804c',
  experienced: '\u793e\u62db',
};

export const JOB_BUCKETS = BUCKETS;

export function jobBucketLabel(bucket) {
  return BUCKET_LABEL[bucket] || String(bucket || '');
}

export function normalizeJobBucket(value) {
  const t = String(value || '').trim().toLowerCase();
  if (BUCKETS.includes(t)) return t;
  if (['intern', 'co-op', 'coop', 'internships', '\u5b9e\u4e60', '\u5b9e\u4e60\u751f'].includes(t)) return 'internship';
  if (['full-time', 'fulltime', 'fulltime_job', '\u5168\u804c'].includes(t)) return 'full_time';
  if (['experienced-hire', 'experienced_hire', 'experienced', 'social', '\u793e\u4f1a\u62db\u8058', '\u793e\u62db'].includes(t)) return 'experienced';
  return null;
}

/**
 * @param {object} job   normalized job object from core.normalizeJob
 * @returns {'internship'|'full_time'|'experienced'}
 */
export function inferJobBucket(jobLike = {}) {
  const blob = [jobLike.title || '', jobLike.description || '', jobLike.jobType || ''].join('\n');
  const minYears = Number.isFinite(jobLike.minExperienceYears) ? jobLike.minExperienceYears : null;
  const isIntern = jobLike.jobType === 'internship' || INTERN_TITLE_RE.test(blob);
  if (isIntern && minYears === null) return 'internship';
  if (isIntern) return minYears >= 3 ? 'experienced' : 'internship';
  if (minYears !== null && minYears >= 3) return 'experienced';
  if (SENIOR_TITLE_RE.test(jobLike.title || '')) return 'experienced';
  if (jobLike.jobType === 'experienced_hire' || jobLike.jobType === 'contract') return 'experienced';
  if (FRESH_GRAD_TITLE_RE.test(blob)) return 'full_time';
  if (jobLike.cohortYear && Number(jobLike.cohortYear) >= 2025) return 'full_time';
  if (jobLike.jobType === 'new_grad_full_time' || jobLike.jobType === 'early_career') return 'full_time';
  if (jobLike.jobType === 'internship') return 'internship';
  // unspecified_full_time / missing jobType: prefer full_time only when no
  // senior signal exists. Otherwise collapse to experienced for safety.
  return 'full_time';
}

export function partitionJobsByBucket(jobs = [], bucket = 'full_time') {
  const seen = new Set();
  const out = [];
  for (const job of jobs) {
    if (job && job.jobBucket === bucket) {
      const key = job.canonicalKey || job.url || out.length;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(job);
    }
  }
  return out;
}
