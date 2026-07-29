import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    out[token.slice(2)] = !next || next.startsWith('--') ? true : next;
    if (out[token.slice(2)] !== true) index += 1;
  }
  return out;
}

export function chinaRecruitmentDisposition(region) {
  const normalized = String(region || '').trim().toLowerCase();
  if ([
    'china',
    'cn',
    '\u4e2d\u56fd',
    '\u4e2d\u56fd\u5927\u9646',
    'mainland china',
  ].includes(normalized)) {
    return 'DOMESTIC_COMPANY_PRIORITY';
  }
  if (['us', 'usa', 'united states', 'canada', 'global'].includes(normalized)) {
    return 'REQUIRE_CHINA_RECRUITMENT_EVIDENCE';
  }
  return 'REVIEW_COUNTRY_REGION';
}

export function auditCompanyMarketRegions({
  databaseFile = 'data/lite-job-search.sqlite',
} = {}) {
  const databasePath = path.resolve(databaseFile);
  const database = new Database(databasePath, { readonly: true });
  try {
    const companies = database.prepare(`
      SELECT id, canonical_name, market, country_region
      FROM companies
      WHERE market = 'CN'
      ORDER BY canonical_name, id
    `).all();
    const items = companies.map((company) => ({
      ...company,
      disposition: chinaRecruitmentDisposition(company.country_region),
    }));
    const counts = items.reduce((result, item) => {
      result[item.disposition] = (result[item.disposition] || 0) + 1;
      return result;
    }, {});
    return {
      status: 'AUDIT_ONLY',
      companies: companies.length,
      counts,
      policy: 'market CN means recruitment target market; foreign headquarters require China recruitment evidence and are not relabelled automatically',
    };
  } finally {
    database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = parseArgs(process.argv.slice(2));
  try {
    process.stdout.write(`${JSON.stringify(auditCompanyMarketRegions({
      databaseFile: input.database,
    }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  }
}
