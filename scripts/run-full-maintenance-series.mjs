import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createControlPlaneService } from '../src/application/control-plane-service.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { runControlTask } from './run-control-task.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`missing value for ${token}`);
    values[key] = next;
    index += 1;
  }
  return values;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBatch({ database, batchId }) {
  while (true) {
    const repository = openSqliteMarketDiscoveryRepository({ file: database });
    repository.migrate();
    const batch = repository.getBatchRun(batchId);
    repository.close();
    if (!batch || !['RUNNING', 'STOP_REQUESTED'].includes(batch.status)) return batch;
    await sleep(15_000);
  }
}

export async function runFullMaintenanceSeries({
  registry,
  database,
  outputRoot,
  profileDir,
  batchSize = 200,
  startOffset = 0,
  waitBatch = '',
} = {}) {
  if (!registry || !database || !outputRoot || !profileDir) {
    throw new Error('registry, database, output-root and profile-dir are required');
  }
  const allCompanies = JSON.parse(await readFile(registry, 'utf8'));
  if (!Array.isArray(allCompanies)) throw new Error('registry must be an array');
  const size = Math.max(1, Math.min(200, Math.trunc(Number(batchSize) || 200)));
  const offset = Math.max(0, Math.trunc(Number(startOffset) || 0));
  if (waitBatch) await waitForBatch({ database, batchId: waitBatch });

  const results = [];
  for (let position = offset; position < allCompanies.length; position += size) {
    const companies = allCompanies.slice(position, position + size);
    const outputDir = path.resolve(outputRoot, `batch-${String(position + 1).padStart(4, '0')}-${String(position + companies.length).padStart(4, '0')}`);
    await mkdir(outputDir, { recursive: true });
    const chunkFile = path.join(outputDir, 'company-queue.json');
    await writeFile(chunkFile, `${JSON.stringify(companies, null, 2)}\n`);

    const repository = openSqliteMarketDiscoveryRepository({ file: database });
    repository.migrate();
    const service = createControlPlaneService({ repository });
    const task = service.createTask({
      role_keywords: ['公开招聘岗位'],
      absolute_date_from: '2026-04-28',
      absolute_date_to: '2026-07-27',
      target_count: companies.length,
      selection_mode: 'RECHECK_EXISTING_AND_NEW',
      target_unit: 'COMPANIES_PROCESSED',
      allow_baidu_fallback: true,
    });
    repository.close();

    let result;
    try {
      result = await runControlTask({
        task: task.id,
        registry: chunkFile,
        database,
        'output-dir': outputDir,
        'profile-dir': profileDir,
        'max-companies-per-run': String(size),
      });
    } catch (error) {
      const failedRepository = openSqliteMarketDiscoveryRepository({ file: database });
      failedRepository.migrate();
      failedRepository.updateControlTaskState({
        id: task.id,
        state: 'FAILED',
        updatedAt: new Date().toISOString(),
      });
      failedRepository.close();
      result = { status: 'FAILED', taskId: task.id, error: String(error.message || error) };
    }
    results.push({ offset: position, count: companies.length, ...result });
    await writeFile(path.join(outputDir, 'series-result.json'), `${JSON.stringify(results.at(-1), null, 2)}\n`);
  }
  return { status: 'COMPLETE', batches: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  runFullMaintenanceSeries({
    registry: args.registry,
    database: args.database,
    outputRoot: args['output-root'],
    profileDir: args['profile-dir'],
    batchSize: args['batch-size'],
    startOffset: args['start-offset'],
    waitBatch: args['wait-batch'],
  }).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${JSON.stringify({ status: 'FAILED', error: String(error.message || error) })}\n`);
      process.exitCode = 2;
    });
}
