import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { runKnownEndpointMonitor } from '../src/application/run-known-endpoint-monitor.mjs';
import { createPageFetcher } from '../src/runtime/fetch-page.mjs';
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
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, target);
}

export async function runKnownEndpointMonitorCli({
  databaseFile = 'data/lite-job-search.sqlite',
  outputDir = 'output/monitoring-network',
  targetCount = 100,
  market = 'CN',
  includeNotDue = false,
  timeoutMs = 15_000,
} = {}) {
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.resolve(databaseFile),
  });
  try {
    repository.migrate();
    const report = await runKnownEndpointMonitor({
      repository,
      fetchPage: createPageFetcher({ timeoutMs }),
      outputDir,
      targetCount,
      market,
      includeNotDue,
    });
    await atomicJson(path.join(outputDir, 'known-endpoint-monitor-report.json'), report);
    return report;
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  runKnownEndpointMonitorCli({
    databaseFile: args.database,
    outputDir: args.output,
    targetCount: args['target-count'],
    market: args.market,
    includeNotDue: args['include-not-due'] === true,
    timeoutMs: args['timeout-ms'],
  }).then((report) => {
    process.stdout.write(`${JSON.stringify({
      mode: report.mode,
      selectedCount: report.selectedCount,
      processedCount: report.processedCount,
      counts: report.counts,
      jobCount: report.jobCount,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
