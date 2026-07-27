import path from 'node:path';

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
const server = createControlPlaneServer({
  repository,
  developmentRecordPath: path.resolve('docs/LJS_DEVELOPMENT_RECORD.md'),
  xlsxPath: args.xlsx ? path.resolve(args.xlsx) : '',
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
