const DIRECTORY_PAGE_TYPES = new Set([
  'CAMPAIGN',
  'JOB_LIST',
  'CAREER_HOME',
  'PLATFORM_ONLY',
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function canonicalDirectoryUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    url.hash = '';
    return url.href;
  } catch {
    throw new Error(`invalid RecruitmentEvent directoryUrl: ${value}`);
  }
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);
}

export function explicitIsoDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const timestamp = value < 10_000_000_000 ? value * 1_000 : value;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime())
      ? date.toISOString().slice(0, 10)
      : null;
  }
  const text = clean(value);
  const match = text.match(
    /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/,
  ) || text.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日/);
  if (!match) return null;
  const [, year, rawMonth, rawDay] = match;
  if (!validDate(year, rawMonth, rawDay)) return null;
  return `${year}-${rawMonth.padStart(2, '0')}-${rawDay.padStart(2, '0')}`;
}

function recruitmentTypeOf(text) {
  if (/日常实习|长期实习|滚动实习|常规实习/i.test(text)) {
    return 'DAILY_INTERNSHIP';
  }
  if (/(?:校招|校园|应届|毕业生).{0,20}(?:实习)|实习.{0,20}(?:校招|校园|应届)/i.test(text)) {
    return 'CAMPUS_INTERNSHIP';
  }
  if (/校招|校园招聘|应届|毕业生|graduate|campus/i.test(text)) {
    return 'CAMPUS_FULL_TIME';
  }
  if (/实习|internship|(?:^|[^a-z])intern(?:[^a-z]|$)/i.test(text)) {
    return 'DAILY_INTERNSHIP';
  }
  if (/社会招聘|社招|experienced|professional hires?|social recruitment/i.test(text)) {
    return 'EXPERIENCED';
  }
  return 'SPECIAL_PROGRAM';
}

function cohortOf(text) {
  const chinese = text.match(/(?:20)?(\d{2})\s*届/);
  if (chinese) return `20${chinese[1]}`;
  const englishAfterYear = text.match(
    /\b(20\d{2})\s+(?:graduate|campus|new[\s-]?grad)(?:\s+(?:program|programme|hiring|recruitment))?\b/i,
  );
  if (englishAfterYear) return englishAfterYear[1];
  const englishBeforeYear = text.match(
    /\b(?:graduate|campus|new[\s-]?grad)(?:\s+(?:program|programme|hiring|recruitment))?\s+(20\d{2})\b/i,
  );
  return englishBeforeYear?.[1] || null;
}

function eventDatesOf({
  structuredStartAt,
  structuredClosesAt,
  pageText = '',
} = {}) {
  let explicitStart = null;
  let explicitClose = null;
  for (const sentence of String(pageText || '').split(/[。；;，,\n]/)) {
    const date = explicitIsoDate(sentence);
    if (!date) continue;
    if (!explicitStart && /启动|开始|开放|发布|上线/i.test(sentence)) {
      explicitStart = date;
    }
    if (!explicitClose && /截止|结束|关闭|停止/i.test(sentence)) {
      explicitClose = date;
    }
  }
  return Object.freeze({
    startAt: explicitIsoDate(structuredStartAt) || explicitStart,
    closesAt: explicitIsoDate(structuredClosesAt) || explicitClose,
  });
}

export function classifyRecruitmentEvent({
  pageTitle = '',
  pageText = '',
  linkText = '',
  jobTitle = '',
  employmentType = '',
  directoryUrl,
  directoryPageType,
  sourceTier = 'OFFICIAL_SITE',
  structuredStartAt = null,
  structuredClosesAt = null,
  locations = [],
} = {}) {
  if (!DIRECTORY_PAGE_TYPES.has(directoryPageType)) {
    throw new Error(`unsupported RecruitmentEvent directoryPageType: ${directoryPageType}`);
  }
  const normalizedDirectoryUrl = canonicalDirectoryUrl(directoryUrl);
  const combinedText = [
    pageTitle,
    linkText,
    jobTitle,
    employmentType,
    normalizedDirectoryUrl,
  ].map(clean).filter(Boolean).join(' ');
  const dates = eventDatesOf({
    structuredStartAt,
    structuredClosesAt,
    pageText,
  });
  const normalizedSourceTier = clean(sourceTier || 'OFFICIAL_SITE').toUpperCase();

  return Object.freeze({
    recruitmentType: recruitmentTypeOf(combinedText),
    cohort: cohortOf(`${combinedText} ${pageText}`),
    campaignName: clean(pageTitle || linkText) || null,
    status: 'OPEN',
    startAt: dates.startAt,
    closesAt: dates.closesAt,
    directoryUrl: normalizedDirectoryUrl,
    locations: Object.freeze([
      ...new Set((locations || []).map(clean).filter(Boolean)),
    ]),
    publicationClass: normalizedSourceTier === 'PLATFORM_ONLY'
      ? 'PLATFORM_ONLY'
      : 'EXPLICIT',
  });
}
