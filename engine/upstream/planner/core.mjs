import { createHash } from 'node:crypto';

const SKILLS = [
  'Swift', 'SwiftUI', 'UIKit', 'Objective-C', 'Xcode', 'Combine', 'Core Data',
  'Firebase', 'TestFlight', 'App Store', 'Flutter', 'React Native', 'Kotlin',
  'Java', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'SQL',
  'PostgreSQL', 'MySQL', 'MongoDB', 'AWS', 'Azure', 'GCP', 'Docker',
  'Kubernetes', 'Git', 'REST', 'GraphQL', 'C++', 'C#', 'Go', 'Ruby',
  'Machine Learning', 'LLM', 'RAG', 'CI/CD', 'MVVM', 'MVC', 'Agile',
  'Excel', 'Tableau', 'Power BI', 'Looker', 'Snowflake', 'Databricks', 'dbt',
  'Spark', 'Pandas', 'NumPy', 'R', 'SAS', 'Stata', 'MATLAB',
  'Spring', 'Django', 'FastAPI', '.NET', 'Kafka', 'Redis', 'Terraform',
  'Jira', 'Figma', 'A/B Testing', 'Product Analytics', 'Roadmapping',
  'Financial Modeling', 'Valuation', 'Bloomberg', 'Capital IQ',
  'Salesforce', 'HubSpot', 'CRM', 'B2B', 'SaaS', 'Account Management',
  'Google Analytics', 'SEO', 'SEM', 'Content Marketing',
  'Verilog', 'SystemVerilog', 'VHDL', 'FPGA', 'PCB', 'Simulink', 'CAD', 'Altium',
  'PyTorch', 'TensorFlow', 'scikit-learn', 'Hugging Face', 'LangChain',
];

const SECTION_STOPS = [
  'qualifications', 'requirements', 'what you bring', 'what we look for',
  'skills', 'preferred', 'nice to have', 'benefits', 'compensation', 'salary',
  'about you', 'who you are', 'education', 'location',
];

export function decodeHtml(value = '') {
  return String(value)
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function htmlToText(html = '') {
  return decodeHtml(String(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?(?:p|div|section|article|li|ul|ol|h[1-6]|br|tr|td|th)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export const MARKET_REGIONS = ['NA', 'CN'];

export function normalizeMarketRegion(value) {
  const token = String(value || '').trim().toUpperCase();
  if (token === 'CN' || token === 'NA') return token;
  if (token === 'CHINA') return 'CN';
  if (token === 'USA' || token === 'US' || token === 'NORTH AMERICA') return 'NA';
  return 'NA';
}

import { parseCnExperience as _parseCnExperience, parseCohortYear as _parseCohortYear, parseCnEducation as _parseCnEducation, inferCnJobType as _inferCnJobType } from '../providers/_cn-entities.mjs';

function cnExperienceBoundaryCheck(text) { return _parseCnExperience(text); }
function cnJobTypeHint(text) { return _inferCnJobType(text); }
function cnCohortYear(text) { return _parseCohortYear(text); }
function cnEducationRequired(text) { return _parseCnEducation(text); }

export const parseCnExperience = _parseCnExperience;
export const parseCohortYear = _parseCohortYear;
export const parseCnEducation = _parseCnEducation;
export const inferCnJobType = _inferCnJobType;
import { inferJobBucket as _inferJobBucket, normalizeJobBucket as _normalizeJobBucket, jobBucketLabel as _jobBucketLabel } from './job-bucket.mjs';
import { inferIndustryBucket as _inferIndustryBucket, normalizeIndustryBucket as _normalizeIndustryBucket, industryBucketLabel as _industryBucketLabel } from './industry-taxonomy.mjs';
export const inferJobBucket = _inferJobBucket;
export const normalizeJobBucket = _normalizeJobBucket;
export const jobBucketLabel = _jobBucketLabel;
export const inferIndustryBucket = _inferIndustryBucket;
export const normalizeIndustryBucket = _normalizeIndustryBucket;
export const industryBucketLabel = _industryBucketLabel;

export function inferMarketRegion(jobLike = {}) {
  if (!jobLike) return 'NA';
  if (jobLike.marketRegion) return normalizeMarketRegion(jobLike.marketRegion);
  const blob = [`${jobLike.url || ''}`, `${jobLike.applyUrl || ''}`, `${jobLike.source || ''}`, `${jobLike.platform || ''}`, `${jobLike.sourceUrl || ''}`].join('\n').toLowerCase();
  const cnHosts = ['zhipin.com', 'nowcoder.com', 'yingjiesheng.com', 'lagou.com', 'liepin.com', 'shixiseng.com', 'maimai.cn', '51job.com', 'kanzhun.com', 'weibo.cn'];
  const naHosts = ['linkedin.com', 'indeed.com', 'job-boards.greenhouse.io', 'jobs.lever.co', 'jobs.ashbyhq.com', 'myworkdayjobs.com', 'teamtailor.com', 'jobs.smartrecruiters.com'];
  if (cnHosts.some((t) => blob.includes(t))) return 'CN';
  if (naHosts.some((t) => blob.includes(t))) return 'NA';
  const country = String(jobLike.country || '').toUpperCase();
  if (['CN','CHINA','MAINLAND CHINA','HONG KONG','TW','TAIWAN','HK','MO','MACAO'].includes(country)) return 'CN';
  if (['US','USA','CA','CANADA','NA','NORTH AMERICA'].includes(country)) return 'NA';
  return 'NA';
}
export function normalizeText(value = '') {
  return String(value).toLowerCase().replace(/[^\p{L}\p{N}+#.-]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function preferSpecificLocation(detailLocation = '', seedLocation = '') {
  const detail = String(detailLocation || '').trim();
  const seed = String(seedLocation || '').trim();
  if (!detail) return seed;
  if (!seed) return detail;
  const normalizedDetail = normalizeText(detail);
  const normalizedSeed = normalizeText(seed);
  if (normalizedSeed.startsWith(normalizedDetail) && normalizedSeed.length > normalizedDetail.length) return seed;
  return detail;
}

export function sourceFromUrl(rawUrl = '') {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('linkedin.com')) return { source: 'LinkedIn', sourceType: 'discovery' };
    if (host.endsWith('indeed.com') || host.includes('.indeed.')) return { source: 'Indeed', sourceType: 'discovery' };
    if (host.endsWith('greenhouse.io')) return { source: 'Greenhouse', sourceType: 'official_ats' };
    if (host.endsWith('ashbyhq.com')) return { source: 'Ashby', sourceType: 'official_ats' };
    if (host.endsWith('lever.co')) return { source: 'Lever', sourceType: 'official_ats' };
    if (host.includes('myworkdayjobs.com')) return { source: 'Workday', sourceType: 'official_ats' };
    if (host.endsWith('smartrecruiters.com')) return { source: 'SmartRecruiters', sourceType: 'official_ats' };
    if (host.endsWith('teamtailor.com')) return { source: 'Teamtailor', sourceType: 'official_ats' };
    return { source: host, sourceType: 'company_site' };
  } catch {
    return { source: 'unknown', sourceType: 'unknown' };
  }
}

export function parseExperience(text = '') {
  const normalized = normalizeText(String(text).replace(/[‐‑‒–—−]/g, '-'));
  const ranges = [];
  const patterns = [
    /(?:minimum|min\.?|at least|至少)?\s*(\d{1,2})\s*(?:-|–|—|to|至)\s*(\d{1,2})\s*(?:\+\s*)?(?:years?|yrs?|年)/gi,
    /(?:minimum|min\.?|at least|至少|不少于)\s*(\d{1,2})\s*\+?\s*(?:years?|yrs?|年)/gi,
    /(\d{1,2})\s*\+\s*(?:years?|yrs?|年)/gi,
    /(?:around|about|roughly|approximately|circa)\s*(\d{1,2})\s*(?:years?|yrs?)\s+(?:of\s+)?[^.\n]{0,50}?experience/gi,
    /(?<![-\d])(\d{1,2})\s*(?:years?|yrs?|年)\s+(?:of\s+)?(?:professional\s+)?experience/gi,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const min = Number(match[1]);
      const max = match[2] === undefined ? null : Number(match[2]);
      const context = normalized.slice(Math.max(0, match.index - 12), match.index + match[0].length + 24);
      if (/years? ago|year-old|old systems?|legacy systems?/.test(context)) continue;
      if (min <= 30 && (max === null || (max >= min && max <= 40))) ranges.push({ min, max, evidence: match[0].trim() });
    }
  }
  if (/no (?:prior|professional) experience|required experience.*none|无需经验|经验不限|freshers? welcome/i.test(text)) {
    ranges.push({ min: 0, max: 0, evidence: 'no prior experience required' });
  }
  if (!ranges.length) return { minYears: null, maxYears: null, evidence: [] };
  return {
    minYears: Math.min(...ranges.map((item) => item.min)),
    maxYears: ranges.some((item) => item.max === null) ? null : Math.max(...ranges.map((item) => item.max)),
    evidence: [...new Set(ranges.map((item) => item.evidence))].slice(0, 5),
  };
}

export function classifyJobType(title = '', description = '', experience = parseExperience(description)) {
  const haystack = `${title}\n${description}`;
  if (/new grad|graduate program|university grad|campus|early career|entry[- ]level|校招|应届|管培生/i.test(title)) return 'new_grad_full_time';
  if (/intern(ship)?|co-?op|实习|暑期项目/i.test(title)) return 'internship';
  if (!/senior|staff|principal|lead|manager|director/i.test(title)
    && (/\b(?:ios|mobile|software)?\s*engineer\s+(?:i|1)\b/i.test(title)
      || /\b(?:junior|jr\.?|associate)\b/i.test(title))) return 'early_career';
  if (/new grad|graduate program|university grad|campus|early career|entry[- ]level|校招|应届|管培生/i.test(description)) return 'new_grad_full_time';
  if (/\b(?:this|the|our|an?)\s+(?:paid\s+|summer\s+)?intern(?:ship)?\b|\binternship\s+(?:role|position|program)\b|实习岗位|暑期项目/i.test(description)) return 'internship';
  if (/contract|contractor|temporary|temp\b|合同工|派遣/i.test(haystack)) return 'contract';
  if (!/senior|staff|principal|lead|manager|director/i.test(title)
    && /\b(?:ios|mobile|software)\s+(?:software\s+)?engineer\s+(?:i|1)\b/i.test(description)) return 'early_career';
  if (experience.minYears !== null && experience.minYears >= 2) return 'experienced_hire';
  if (experience.minYears !== null && experience.minYears <= 1) return 'early_career';
  return 'unspecified_full_time';
}

export function extractSkills(text = '') {
  const normalized = normalizeText(text);
  return SKILLS.filter((skill) => {
    const target = normalizeText(skill);
    if (!target) return false;
    const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}\\p{N}+#])${escaped}(?=$|[^\\p{L}\\p{N}+#])`, 'u').test(normalized);
  });
}

function section(text, starts) {
  const lines = String(text).split('\n').map((line) => line.trim()).filter(Boolean);
  const index = lines.findIndex((line) => starts.some((name) => normalizeText(line).startsWith(name)));
  if (index < 0) return '';
  const selected = [];
  for (const line of lines.slice(index + 1)) {
    const heading = normalizeText(line.replace(/:$/, ''));
    if (SECTION_STOPS.some((stop) => heading === stop || heading.startsWith(`${stop} `))) break;
    selected.push(line.replace(/^[-*•]\s*/, ''));
    if (selected.join(' ').length >= 1200) break;
  }
  return selected.join(' ').trim();
}

export function extractResponsibilities(text = '') {
  const value = section(text, ['responsibilities', 'what you will do', "what you'll do", 'the work', '岗位职责', '工作职责']);
  if (value) return value;
  return String(text).split('\n').map((line) => line.trim()).filter((line) => line.length >= 35).slice(0, 5).join(' ').slice(0, 1200);
}

export function extractRequirements(text = '') {
  return section(text, ['requirements', 'qualifications', 'what you bring', 'what we look for', '任职要求', '岗位要求']).slice(0, 1200);
}

export function canonicalCompany(value = '') {
  return normalizeText(value)
    .replace(/\b(inc|incorporated|corp|corporation|company|co|llc|ltd|limited|technologies|technology)\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function canonicalTitle(value = '') {
  return normalizeText(value)
    .replace(/\b(sr|senior|jr|junior|i{1,3}|1|2|3)\b/g, ' ')
    .replace(/\b(new grad|graduate|early career|entry level)\b/g, ' ')
    .replace(/[^\p{L}\p{N}+#]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function stableJobKey(job) {
  const company = canonicalCompany(job.company);
  const title = canonicalTitle(job.title);
  const location = normalizeText(job.location).replace(/remote/g, '').trim();
  return createHash('sha1').update(`${company}|${title}|${location}`).digest('hex').slice(0, 20);
}

export function dedupeJobs(jobs = [], { region = null, splitByRegion = true } = {}) {
  const groups = new Map();
  if (splitByRegion && !region) {
    for (const job of jobs) {
      const r = normalizeMarketRegion(job.marketRegion ?? inferMarketRegion(job));
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(job);
    }
  } else {
    const r = normalizeMarketRegion(region);
    groups.set(r, jobs);
  }
  const all = [];
  for (const [r, scoped] of groups) all.push(...dedupeByRegion(scoped, r));
  return all;
}

function dedupeByRegion(internalJobs, region) {
  const byUrl = new Map();
  for (const job of internalJobs) {
    let urlKey = job.url;
    try {
      const url = new URL(job.url);
      url.hash = '';
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|gh_src|source|ref|trk)/i.test(key)) url.searchParams.delete(key);
      }
      urlKey = url.toString().replace(/\/$/, '');
    } catch {}
    const existing = byUrl.get(urlKey);
    if (!existing) {
      byUrl.set(urlKey, { ...job, url: urlKey, marketRegion: region });
      continue;
    }
    const preferred = richness(job) > richness(existing) ? { ...job, url: urlKey, marketRegion: region } : existing;
    const other = preferred === existing ? job : existing;
    mergeSourceMetadata(preferred, other);
    preferred.marketRegion = region;
    byUrl.set(urlKey, preferred);
  }

  const byIdentity = new Map();
  for (const job of byUrl.values()) {
    const key = stableJobKey(job);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, { ...job, canonicalKey: key, alternateUrls: [...new Set(job.alternateUrls || [])], marketRegion: region });
      continue;
    }
    const preferred = preferOfficial(existing, job);
    const other = preferred === existing ? job : existing;
    mergeSourceMetadata(preferred, other, [other.url]);
    preferred.crossSourceDuplicate = true;
    preferred.marketRegion = region;
    byIdentity.set(key, preferred);
  }
  return [...byIdentity.values()];
}

function mergeSourceMetadata(target, source, extraUrls = []) {
  target.alternateUrls = [...new Set([
    ...(target.alternateUrls || []),
    ...extraUrls,
    source.platformUrl,
    ...(source.alternateUrls || []),
  ].filter(Boolean))];
  target.discoveryEvidence = [...(target.discoveryEvidence || []), ...(source.discoveryEvidence || [])]
    .filter((item, index, items) => item?.url && items.findIndex((candidate) => candidate?.url === item.url) === index);
  if (!target.platformUrl && source.platformUrl) target.platformUrl = source.platformUrl;
}

function richness(job) {
  return (job.description?.length || 0) + (job.company ? 50 : 0) + (job.location ? 30 : 0) + (job.postedAt ? 20 : 0);
}

function preferOfficial(a, b) {
  const rank = { official_ats: 4, company_site: 3, verified_platform_apply: 2, discovery: 1, unknown: 0 };
  const ar = rank[a.sourceType] ?? 0;
  const br = rank[b.sourceType] ?? 0;
  if (ar !== br) return ar > br ? a : b;
  return richness(a) >= richness(b) ? a : b;
}

export function parseProfile(profile = {}, cvText = '') {
  const targetRoles = [...(profile?.target_roles?.primary || []), ...(profile?.target_roles?.archetypes || []).map((item) => item.name)].filter(Boolean);
  const locationValues = [
    ...(profile?.search_preferences?.locations || []),
    profile?.location?.country,
    profile?.location?.city,
    profile?.candidate?.location,
  ].filter(Boolean);
  return {
    studentId: normalizeText(profile?.candidate?.email || profile?.candidate?.full_name || 'student').replace(/\s/g, '-'),
    studentName: profile?.candidate?.full_name || 'Student',
    targetRoles,
    targetRoleTokens: new Set(targetRoles.flatMap((value) => normalizeText(value).split(' ')).filter((v) => v.length > 1)),
    skills: extractSkills(`${cvText}\n${JSON.stringify(profile?.narrative || {})}`),
    locations: locationValues,
    visaStatus: profile?.location?.visa_status || '',
    maxExperienceYears: Number.isFinite(profile?.search_preferences?.max_experience_years)
      ? profile.search_preferences.max_experience_years : null,
    allowedJobTypes: profile?.search_preferences?.job_types || [],
  };
}

function matchesStudentLocation(student, job) {
  const jobLocation = String(job.location || '');
  const normalizedJob = normalizeText(jobLocation);
  if (!normalizedJob) return false;
  if (/remote/i.test(jobLocation)) return student.locations.some((value) => /remote|united states|canada|north america/i.test(value));
  if (student.locations.some((value) => normalizedJob.includes(normalizeText(value)) || normalizeText(value).includes(normalizedJob))) return true;
  const wantsUS = student.locations.some((value) => /united states|\bu\.?s\.?a?\b|north america/i.test(value));
  const wantsCanada = student.locations.some((value) => /canada|north america/i.test(value));
  const appearsUS = /\b(?:united states|usa|us|u\.s\.)\b/i.test(jobLocation)
    || /(?:^|[\s,(·-])(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)(?:\b|$)/.test(jobLocation)
    || /\b(?:alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia|d\.c\.)\b/i.test(jobLocation);
  const appearsCanada = /\b(?:canada|ontario|quebec|british columbia|alberta|manitoba|saskatchewan|nova scotia|new brunswick|newfoundland|prince edward island|toronto|montreal|vancouver|calgary|ottawa)\b/i.test(jobLocation);
  return (wantsUS && appearsUS) || (wantsCanada && appearsCanada);
}

export function scoreMatch(student, job) {
  const reasons = [];
  const gaps = [];
  const exclusionReasons = [];
  const titleTokens = new Set(normalizeText(job.title).split(' ').filter((v) => v.length > 1));
  const roleMatches = [...student.targetRoleTokens].filter((token) => titleTokens.has(token));
  const skillMatches = student.skills.filter((skill) => job.skills.includes(skill));
  const requiredSkills = job.skills || [];
  const skillRatio = requiredSkills.length ? skillMatches.length / Math.min(requiredSkills.length, 10) : 0.25;

  let score = 35 * Math.min(1, roleMatches.length / 2) + 35 * Math.min(1, skillRatio);
  if (roleMatches.length) reasons.push(`Role alignment: ${roleMatches.join(', ')}`);
  if (skillMatches.length) reasons.push(`Skill matches: ${skillMatches.slice(0, 8).join(', ')}`);

  if (job.jobType === 'internship' || job.jobType === 'new_grad_full_time' || job.jobType === 'early_career') {
    score += 15;
    reasons.push(`Career stage: ${job.jobType}`);
  } else if (job.minExperienceYears !== null && job.minExperienceYears > 1) {
    score -= 30;
    gaps.push(`Requires at least ${job.minExperienceYears} years of experience`);
  }

  const locationMatch = matchesStudentLocation(student, job);
  if (locationMatch) {
    score += 10;
    reasons.push(`Location alignment: ${job.location}`);
  } else if (student.locations.length && job.location) {
    exclusionReasons.push(`Location ${job.location} is outside student preferences`);
  } else if (student.locations.length && !job.location) {
    exclusionReasons.push('Job location is missing and cannot be verified');
  }

  const authorizationText = `${job.description}\n${job.requirements}`;
  const noSponsorship = /no (?:visa |immigration )?sponsorship|(?:visa |immigration )?sponsorship (?:is |will be )?not (?:available|provided|offered)|without (?:current or future|now or in the future).*sponsorship|must be (?:work[- ]?)?authorized.{0,80}without.{0,30}sponsorship/i.test(authorizationText);
  const studentAuthorizationAccepted = /(?:welcome|accept|eligible).{0,60}(?:student visa|f-?1|opt)|(?:student visa|f-?1|opt).{0,60}(?:welcome|apply|eligible|accepted)/i.test(authorizationText);
  const sponsorshipRisk = noSponsorship || /must be (?:a )?u\.?s\.? citizen|security clearance|\bitar\b/i.test(authorizationText);
  const hardAuthorizationRisk = /must be (?:a )?u\.?s\.? citizen|u\.?s\.? citizenship (?:is )?required|security clearance|\bitar\b|(?:does not|do not|cannot|can't|unable to) (?:sponsor|support).{0,40}(?:opt|stem opt)|no (?:cpt|opt)|not (?:eligible|available) for (?:cpt|opt)/i.test(authorizationText);
  if (sponsorshipRisk) {
    score -= 35;
    gaps.push('Work-authorization or citizenship restriction detected');
  }
  if (hardAuthorizationRisk && /f-?1|opt|international/i.test(student.visaStatus || '')) {
    exclusionReasons.push('Explicit citizenship, clearance, ITAR, CPT or OPT restriction conflicts with student status');
  }
  if (noSponsorship && !studentAuthorizationAccepted && /f-?1|opt|international|sponsor/i.test(student.visaStatus || '')) {
    gaps.push('Employer does not offer current or future sponsorship; OPT may permit an initial work period');
  }
  if (job.livenessStatus === 'active') score += 5;
  if (job.sourceType === 'discovery') gaps.push('Discovery-only link; replace with company/ATS apply URL');

  if (student.maxExperienceYears !== null && job.minExperienceYears !== null
    && job.minExperienceYears > student.maxExperienceYears) {
    exclusionReasons.push(`Minimum experience ${job.minExperienceYears} years exceeds student limit ${student.maxExperienceYears}`);
  }
  if (student.maxExperienceYears !== null && student.maxExperienceYears <= 1
    && job.minExperienceYears === null && job.jobType === 'unspecified_full_time') {
    exclusionReasons.push('No experience requirement or verified entry-level signal was found');
  }
  if (student.maxExperienceYears !== null && student.maxExperienceYears <= 1
    && /\b(?:senior|sênior|sr\.?|staff|principal|lead|manager|director|expert)\b|\bengineer\s+(?:ii|iii|iv)\b/i.test(job.title)) {
    exclusionReasons.push(`Title ${job.title} is above entry level`);
  }
  if (student.allowedJobTypes.length && !student.allowedJobTypes.includes(job.jobType)) {
    exclusionReasons.push(`Job type ${job.jobType} is outside student preferences`);
  }
  if (job.livenessStatus !== 'active') exclusionReasons.push(`Liveness is ${job.livenessStatus}`);
  if (job.needsOfficialLink) exclusionReasons.push('Official company/ATS application link is missing');

  const missingSkills = requiredSkills.filter((skill) => !student.skills.includes(skill)).slice(0, 6);
  if (missingSkills.length) gaps.push(`Missing or unproven skills: ${missingSkills.join(', ')}`);
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  const eligible = exclusionReasons.length === 0;
  const priority = !eligible ? 'Exclude' : bounded >= 75 ? 'High' : bounded >= 55 ? 'Medium' : 'Low';
  return { studentId: student.studentId, studentName: student.studentName, jobKey: job.canonicalKey, score: bounded, priority, eligible, exclusionReasons, reasons, gaps, marketRegion: normalizeMarketRegion(job.marketRegion ?? inferMarketRegion(job)) };
}

export function normalizeJob(input = {}) {
  const description = htmlToText(input.description || '');
  const experience = parseExperience(`${input.title || ''}\n${description}`);
  const source = sourceFromUrl(input.url || input.applyUrl || '');
  const job = {
    jobId: String(input.jobId || input.id || ''),
    title: String(input.title || '').trim(),
    normalizedTitle: canonicalTitle(input.title || ''),
    company: String(input.company || '').trim(),
    organizationType: String(input.organizationType || ''),
    companySize: input.companySize ?? null,
    companyWebsite: String(input.companyWebsite || ''),
    careerSite: String(input.careerSite || ''),
    campusSite: String(input.campusSite || ''),
    location: String(input.location || '').trim(),
    country: String(input.country || ''),
    city: String(input.city || ''),
    workMode: String(input.workMode || (/remote/i.test(input.location || '') ? 'remote' : 'unspecified')),
    description,
    responsibilities: input.responsibilities || extractResponsibilities(description),
    requirements: input.requirements || extractRequirements(description),
    skills: input.skills || extractSkills(description),
    minExperienceYears: experience.minYears,
    maxExperienceYears: experience.maxYears,
    experienceEvidence: experience.evidence,
    jobType: input.jobType || classifyJobType(input.title || '', description, experience),
    postedAt: input.postedAt || null,
    expiresAt: input.expiresAt || null,
    lastVerifiedAt: input.lastVerifiedAt || null,
    browserVerified: input.browserVerified === true,
    jdVerified: input.jdVerified === true,
    timeVerified: input.timeVerified === true,
    applicationMethod: String(input.applicationMethod || ''),
    platform: String(input.platform || ''),
    livenessStatus: input.livenessStatus || 'unverified',
    livenessReason: input.livenessReason || '',
    url: String(input.url || input.applyUrl || ''),
    applyUrl: String(input.applyUrl || input.url || ''),
    source: input.source || source.source,
    sourceType: input.sourceType || source.sourceType,
    sourceUrl: String(input.sourceUrl || input.url || ''),
    platformUrl: String(input.platformUrl || ''),
    marketRegion: normalizeMarketRegion(input.marketRegion ?? inferMarketRegion(input)),
    jobBucket: _normalizeJobBucket(input.jobBucket ?? _inferJobBucket({ title: input.title || '', description: description, jobType: input.jobType || classifyJobType(input.title || '', description, parseExperience(description)), minExperienceYears: (typeof parseExperience(description) === 'object' ? parseExperience(description).minYears : null), cohortYear: input.cohortYear })) ?? 'full_time',
    industryBucket: _normalizeIndustryBucket(input.industryBucket ?? _inferIndustryBucket({ title: input.title || '', description: description, platform: input.platform || '', company: input.company || '' })) ?? 'interdisciplinary',
    cohortYear: Number.isFinite(input.cohortYear) ? input.cohortYear : null,
    educationRequired: String(input.educationRequired || ''),
    alternateUrls: [...new Set((input.alternateUrls || []).filter(Boolean).map(String))],
    discoveryEvidence: Array.isArray(input.discoveryEvidence) ? input.discoveryEvidence : [],
    needsOfficialLink: (input.sourceType || source.sourceType) === 'discovery',
    trustScore: input.trustScore ?? null,
    trustFlags: input.trustFlags || [],
  };
  if (job.marketRegion === 'CN') {
    const blob = (job.title || '') + '\n' + (job.description || '') + '\n' + (job.requirements || '');
    const cnExp = cnExperienceBoundaryCheck(blob);
    if (cnExp.minYears !== null && (job.minExperienceYears === null || cnExp.minYears < job.minExperienceYears)) job.minExperienceYears = cnExp.minYears;
    if (cnExp.maxYears !== null && (job.maxExperienceYears === null || cnExp.maxYears < job.maxExperienceYears)) job.maxExperienceYears = cnExp.maxYears;
    if (cnExp.evidence && cnExp.evidence.length) job.experienceEvidence = [...(job.experienceEvidence || []), ...cnExp.evidence];
    const cohort = cnCohortYear(blob);
    if (cohort) job.cohortYear = cohort;
    const edu = cnEducationRequired(blob);
    if (edu) job.educationRequired = edu;
    const cnType = cnJobTypeHint(blob);
    if (cnType && (!job.jobType || job.jobType === 'unspecified_full_time')) job.jobType = cnType;
  }
    job.canonicalKey = stableJobKey(job);
  return job;
}

export function aggregateCompanies(jobs = []) {
  const companies = new Map();
  for (const job of jobs) {
    const key = canonicalCompany(job.company) || job.company || 'unknown';
    const row = companies.get(key) || {
      company: job.company || 'Unknown', companySize: job.companySize, companyWebsite: job.companyWebsite,
      careerSite: job.careerSite, campusSite: job.campusSite, openJobCount: 0, jobs: [], locations: new Set(), sources: new Set(),
      marketRegion: normalizeMarketRegion(job.marketRegion ?? inferMarketRegion(job)),
    };
    row.openJobCount += 1;
    row.jobs.push({ title: job.title, location: job.location, url: job.applyUrl, sourceUrl: job.sourceUrl, jobType: job.jobType });
    if (job.location) row.locations.add(job.location);
    if (job.source) row.sources.add(job.source);
    row.companySize ??= job.companySize;
    row.companyWebsite ||= job.companyWebsite;
    row.careerSite ||= job.careerSite;
    row.campusSite ||= job.campusSite;
    companies.set(key, row);
  }
  return [...companies.values()].map((row) => ({ ...row, locations: [...row.locations], sources: [...row.sources] }));
}
