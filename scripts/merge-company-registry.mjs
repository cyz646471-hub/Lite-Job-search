import fs from 'node:fs';
import Database from 'better-sqlite3';

const sourcePath = process.argv[2] || 'Z:/mini code/Lite-Job-search/data/company-registry/golden-seed-companies-current.json';
const seedPath = process.argv[3] || 'data/company-registry/cn-company-search-seed-v1.json';
const mergedPath = process.argv[4] || 'data/company-registry/golden-seed-companies-merged-current.json';
const reportPath = process.argv[5] || 'test-output/canary/company-registry-merge-report.json';

const normalize = (value) => String(value ?? '').trim().toLowerCase()
  .replace(/[（）()]/g, '').replace(/[\s·\-—_/]+/g, '');
const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const records = [...source];
const seen = new Set(records.flatMap((r) => [r.name_cn, r.name_en, ...(r.aliases || []), ...(r.official_domains || [])].map(normalize).filter(Boolean)));
const appended = [];
for (const name of seed.rawCompanies || []) {
  const key = normalize(name);
  if (!key || seen.has(key)) continue;
  records.push({ name_cn: name, name_en: null, aliases: [], industry: ['pending'], country_region: 'China', official_domains: [], sources: ['user-212'], incomplete: true });
  seen.add(key); appended.push(name);
}
const domainErrors = records.filter((r) => (r.official_domains || []).some((d) => !/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(d)));
const nameErrors = records.filter((r) => !String(r.name_cn || '').trim());
const db = new Database('data/lite-job-search.sqlite', { readonly: true });
const dbNames = db.prepare('SELECT canonical_name, chinese_name, english_name FROM companies WHERE market = ?').all('CN');
const completedKeys = new Set(dbNames.flatMap((r) => [r.canonical_name, r.chinese_name, r.english_name].map(normalize).filter(Boolean)));
db.close();
const pending = records.filter((r) => ![r.name_cn, r.name_en, ...(r.aliases || [])].map(normalize).some((k) => completedKeys.has(k)));
fs.mkdirSync(new URL('.', `file://${process.cwd().replaceAll('\\', '/')}/`), { recursive: true });
fs.mkdirSync('data/company-registry', { recursive: true });
fs.mkdirSync('test-output/canary', { recursive: true });
fs.writeFileSync(mergedPath, JSON.stringify(records, null, 2) + '\n');
fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), sourceCount: source.length, existingListCount: (seed.rawCompanies || []).length, mergedCount: records.length, appendedCount: appended.length, databaseCompanyCount: dbNames.length, pendingCount: pending.length, invalidNameCount: nameErrors.length, invalidDomainCount: domainErrors.length, appendedCompanies: appended, pendingCompanies: pending.map((r) => r.name_cn) }, null, 2) + '\n');
console.log(JSON.stringify({ sourceCount: source.length, existingListCount: (seed.rawCompanies || []).length, mergedCount: records.length, appendedCount: appended.length, databaseCompanyCount: dbNames.length, pendingCount: pending.length, invalidNameCount: nameErrors.length, invalidDomainCount: domainErrors.length, reportPath, mergedPath }));
