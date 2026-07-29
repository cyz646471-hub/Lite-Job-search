import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { buildCnAtsCoverageReport } from '../src/application/build-cn-ats-coverage-report.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const next = argv[index + 1];
    values[token.slice(2)] = !next || next.startsWith('--') ? true : next;
    if (values[token.slice(2)] !== true) index += 1;
  }
  return values;
}
async function atomicJson(file, value) {
  const absolute = path.resolve(file);
  await mkdir(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, absolute);
}

export async function auditCnAtsCoverage({
  databaseFile = 'data/lite-job-search.sqlite',
  outputFile = 'output/monitoring-network/cn-ats-coverage.json',
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.resolve(databaseFile),
  });
  try {
    repository.migrate();
    const report = buildCnAtsCoverageReport({
      companies: repository.listCompanies(),
      portals: repository.listCareerPortals(),
      sourceEndpoints: repository.listSourceEndpoints(),
    });
    await atomicJson(outputFile, report);
    return report;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  auditCnAtsCoverage({
    databaseFile: args.database,
    outputFile: args.output,
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      market: report.market,
      totalFamilies: report.totalFamilies,
      top: report.rows.slice(0, 10),
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
