import path from 'node:path';

import { createControlPlaneExportService } from '../src/application/generate-control-plane-exports.mjs';
import { createControlPlaneWorkerLauncher } from '../src/application/control-plane-worker-launcher.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { createControlPlaneServer } from '../src/web/control-plane-server.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const database = path.resolve(args.database || 'data/lite-job-search.sqlite');
const host = String(args.host || '127.0.0.1');
const port = Math.max(1, Math.min(65_535, Number(args.port) || 4317));
const repository = openSqliteMarketDiscoveryRepository({ file: database });
repository.migrate();
const exportService = createControlPlaneExportService({
  repository,
  outputDirectory: path.resolve(args['export-dir'] || 'test-output/control-plane-exports'),
});
const workerLauncher = args['worker-registry']
  ? createControlPlaneWorkerLauncher({
    repository,
    database,
    registry: path.resolve(args['worker-registry']),
    outputDirectory: path.resolve(args['worker-output-dir'] || 'test-output/control-plane-worker'),
    profileDirectory: path.resolve(args['worker-profile-dir'] || 'data/browser-profiles/career-op-main'),
    maxCompaniesPerRun: Math.max(
      1,
      Math.min(200, Number(args['worker-max-companies-per-run']) || 10),
    ),
    timeoutMs: Math.max(
      1_000,
      Math.min(30_000, Number(args['worker-timeout-ms']) || 15_000),
    ),
    searchDelayMs: Math.max(
      10_000,
      Math.min(60_000, Number(args['worker-search-delay-ms']) || 10_000),
    ),
    searchJitterMs: Math.max(
      0,
      Math.min(
        60_000,
        args['worker-search-jitter-ms'] == null
          ? 4_000
          : Number(args['worker-search-jitter-ms']),
      ),
    ),
  })
  : null;
const server = createControlPlaneServer({
  repository,
  developmentRecordPath: path.resolve('docs/LJS_DEVELOPMENT_RECORD.md'),
  xlsxPath: args.xlsx ? path.resolve(args.xlsx) : '',
  buildStudentWorkbook: exportService.buildStudentWorkbook,
  buildCompanyWorkbook: exportService.buildCompanyWorkbook,
  workerLauncher,
});
server.listen(port, host, () => {
  process.stdout.write(`${JSON.stringify({
    status: 'RUNNING',
    url: `http://${host}:${port}`,
    database,
  })}\n`);
});
const close = () => server.close(() => {
  repository.close();
  process.exit(0);
});
process.on('SIGINT', close);
process.on('SIGTERM', close);
