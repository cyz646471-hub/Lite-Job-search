import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { ingestBrowserCompanyResult } from '../src/application/ingest-browser-company-result.mjs';
import { createCompany } from '../src/domain/company.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

const root = new URL('../', import.meta.url);
const dbFile = fileURLToPath(new URL('./data/lite-job-search.sqlite', root));
const batchFile = fileURLToPath(new URL('./test-output/canary/browser-batch-50.json', root));
const searchFile = fileURLToPath(new URL('./test-output/canary/browser-batch-50-results.json', root));
const pageFile = fileURLToPath(new URL('./test-output/canary/browser-batch-50-verified-pages.json', root));
const checkpointFile = fileURLToPath(new URL('./test-output/canary/browser-batch-50-ingest-checkpoint.json', root));

const now = () => new Date().toISOString();
const stableId = (prefix, value) => `${prefix}-${createHash('sha256').update(String(value)).digest('hex').slice(0, 24)}`;
const parseHost = (url) => { try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const allowedOfficialHosts = new Set([
  'campus.cvte.com', 'talent.alibaba.com', 'job.ch.com', 'talent.didiglobal.com',
  'career.centurygames.cn', 'sz.duoyi.com', 'jhicc.com', 'qualcomm.cn',
  'goertek.com', 'job.gf.com.cn', 'getholdings.com.cn', 'gz-goam.com',
  'guizhoulinhua.com',
]);

const companies = JSON.parse(await readFile(batchFile, 'utf8'));
const searchResults = JSON.parse(await readFile(searchFile, 'utf8'));
const pages = JSON.parse(await readFile(pageFile, 'utf8'));
const pageByRequested = new Map(pages.map((page) => [page.url, page]));
const repository = openSqliteMarketDiscoveryRepository({ file: dbFile });
repository.migrate();

const checkpoint = { generatedAt: now(), batchSize: companies.length, processed: [], failures: [] };
for (const item of companies) {
  const companyName = item.company;
  try {
    const found = searchResults.find((record) => record.company === companyName);
    const candidates = (found?.links || [])
      .filter((link) => !/(jobui\.com|hao123\.com|liepin\.com|zhipin\.com|51job\.com)/i.test(link.href))
      .map((link, index) => ({ url: link.href, title: link.text, rank: index + 1 }));
    const observations = candidates.map((candidate) => pageByRequested.get(candidate.url)).filter(Boolean);
    const companyId = stableId('company', `CN|${companyName}`);
    if (!candidates.length) {
      repository.upsertCompany(createCompany({
        id: companyId, canonicalName: companyName, market: 'CN', countryRegion: '中国大陆',
      }, { now: now() }));
      checkpoint.processed.push({ company: companyName, status: 'NO_CANDIDATE', candidates: 0, verified: 0, jobs: 0 });
      await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
      continue;
    }
    const officialHost = candidates.map((candidate) => parseHost(candidate.url)).find((host) => allowedOfficialHosts.has(host));
    const result = await ingestBrowserCompanyResult({
      companyResult: {
        company: companyName,
        query: `${companyName} 招聘`,
        officialDomain: officialHost || '',
        officialCandidates: candidates,
        observations,
      },
      role: '公开招聘岗位',
      targetCount: 1000,
      freshnessDays: 90,
    }, { repository, now });
    checkpoint.processed.push({
      company: companyName,
      status: result.status,
      candidates: result.report.candidateUrlCount,
      verified: result.officialVerifiedCount,
      review: result.reviewCount,
      rejected: result.rejectedCount,
      jobs: result.extractedJobCount,
      failures: result.report.failures,
    });
    await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
  } catch (error) {
    checkpoint.failures.push({ company: companyName, error: String(error?.message || error) });
    await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
  }
}
repository.close();
checkpoint.completedAt = now();
await writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2), 'utf8');
console.log(JSON.stringify({ processed: checkpoint.processed.length, failures: checkpoint.failures.length, checkpointFile }, null, 2));
