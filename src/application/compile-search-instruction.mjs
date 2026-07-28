import { createHash } from 'node:crypto';

const MARKET_RULES = Object.freeze([
  {
    market: 'CN',
    countryRegion: '中国大陆',
    pattern: /中国大陆|中国|国内/,
  },
  {
    market: 'NA',
    countryRegion: '美国和加拿大',
    pattern: /北美|美国|加拿大/,
  },
]);

const KNOWN_ROLES = Object.freeze([
  ['AI产品经理', 'ai-product-manager'],
  ['人工智能产品经理', 'ai-product-manager'],
  ['大模型产品经理', 'llm-product-manager'],
  ['产品经理', 'product-manager'],
  ['后端开发', 'backend-engineer'],
  ['后端工程师', 'backend-engineer'],
  ['市场营销', 'marketing'],
  ['海外市场', 'global-marketing'],
  ['AI岗位', 'ai-jobs'],
  ['人工智能岗位', 'ai-jobs'],
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dateStamp(date) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

function asciiSlug(value) {
  const known = KNOWN_ROLES.find(([role]) => role === value);
  if (known) return known[1];
  const ascii = clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return ascii || 'role';
}

export function parseFreshnessDays(instruction) {
  const text = clean(instruction);
  const match = text.match(/(?:近|最近)\s*(\d+)\s*(天|日|周|星期|个?月)(?:内)?/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isInteger(amount) || amount < 1) return null;
  if (['周', '星期'].includes(match[2])) return amount * 7;
  if (match[2].includes('月')) return amount * 30;
  return amount;
}

function parseMarket(instruction) {
  const matches = MARKET_RULES.filter((rule) => rule.pattern.test(instruction));
  if (matches.length !== 1) throw new Error('instruction requires exactly one supported market');
  return matches[0];
}

function parseRole(instruction) {
  const known = KNOWN_ROLES.find(([role]) => instruction.includes(role));
  if (known) return known[0];
  const match = instruction.match(/开放\s*([^，,。]{1,40}?)(?:方向)?岗位/);
  return clean(match?.[1]);
}

function parseTargetCount(instruction) {
  const afterCompany = instruction.match(/公司\s*(\d+)\s*(?:个|家)?/);
  const beforeCompany = instruction.match(/(\d+)\s*(?:个|家)\s*公司/);
  const count = Number(afterCompany?.[1] || beforeCompany?.[1]);
  if (!Number.isInteger(count) || count < 1 || count > 1000) {
    throw new Error('instruction requires a target count between 1 and 1000');
  }
  return count;
}

function parseLocation(instruction) {
  const match = instruction.match(/在\s*([^，,。]{1,20}?)(?:地区)?\s*开放/);
  return clean(match?.[1]);
}

function parseIndustry(instruction) {
  const match = instruction.match(/(?:行业(?:方向)?为?|面向)\s*([^，,。]{1,24})/);
  return clean(match?.[1]);
}

function parseSearchEngine(instruction) {
  return /google|谷歌/i.test(instruction) ? 'google' : 'baidu';
}

export function compileSearchInstruction(instruction, {
  now = () => new Date(),
} = {}) {
  const normalizedInstruction = clean(instruction);
  if (!normalizedInstruction) throw new Error('instruction is required');
  const market = parseMarket(normalizedInstruction);
  const role = parseRole(normalizedInstruction);
  if (!role) throw new Error('instruction requires a role');
  const targetCount = parseTargetCount(normalizedInstruction);
  const freshnessDays = parseFreshnessDays(normalizedInstruction) ?? 90;
  if (freshnessDays < 1 || freshnessDays > 3650) {
    throw new Error('instruction freshness range must be between 1 and 3650 days');
  }
  const current = now();
  if (!(current instanceof Date) || Number.isNaN(current.getTime())) {
    throw new Error('now must return a valid Date');
  }
  const roleSlug = asciiSlug(role);
  const digest = createHash('sha256')
    .update(normalizedInstruction)
    .digest('hex')
    .slice(0, 8);
  const batchId = `instruction-${market.market.toLowerCase()}-${roleSlug}-${dateStamp(current)}-${digest}`;
  const outputDir = `test-output/instructions/${batchId}`;
  const searchEngine = parseSearchEngine(normalizedInstruction);

  return Object.freeze({
    instruction: normalizedInstruction,
    market: market.market,
    countryRegion: market.countryRegion,
    role,
    industry: parseIndustry(normalizedInstruction),
    location: parseLocation(normalizedInstruction),
    freshnessDays,
    targetCount,
    batchId,
    registry: 'data/company-registry/golden-seed-companies-merged-current.json',
    database: 'data/lite-job-search.sqlite',
    outputDir,
    xlsxOutput: `${outputDir}/student-applications.xlsx`,
    browserMode: 'persistent-chrome',
    searchEngine,
    searchSources: Object.freeze([`chrome_${searchEngine}_visible_search`]),
    disabledSearchSources: Object.freeze(['baidu_api', 'apify', 'automatic_engine_fallback']),
    maxCompaniesPerRun: 10,
    searchDelayMs: 4_000,
    searchJitterMs: 20_000,
    maxResults: 10,
    maxCandidates: 3,
    maxCareerEntries: 5,
    maxDepth: 2,
    timeoutMs: 10_000,
    compiledAt: current.toISOString(),
  });
}
