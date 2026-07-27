import path from 'node:path';

import { createControlPlaneService } from '../src/application/control-plane-service.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const values = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith('--')) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

const args = parseArgs(process.argv.slice(2));
const repository = openSqliteMarketDiscoveryRepository({
  file: path.resolve(args.database || 'data/lite-job-search.sqlite'),
});
repository.migrate();
try {
  const service = createControlPlaneService({
    repository,
    actor: 'local-cli-user',
  });
  let result;
  if (args.command === 'status') {
    result = service.status();
  } else {
    if (args.confirm !== true) throw new Error('write command requires --confirm');
    if (args.command === 'stop') {
      if (!args.batch) throw new Error('stop requires --batch');
      result = service.stopBatch(args.batch);
    } else if (args.command === 'resume') {
      if (!args.batch) throw new Error('resume requires --batch');
      result = service.resumeBatch(args.batch);
    } else if (args.command === 'baidu-ack') {
      result = service.acknowledgeBaidu();
    } else if (args.command === 'provider-ack') {
      if (!args.provider) throw new Error('provider-ack requires --provider baidu|google');
      result = service.acknowledgeSearchProvider(args.provider);
    } else {
      throw new Error(`unsupported control command: ${args.command}`);
    }
  }
  process.stdout.write(`${JSON.stringify({ status: 'OK', result }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: 'FAILED',
    error: String(error?.message || error),
  })}\n`);
  process.exitCode = 2;
} finally {
  repository.close();
}
