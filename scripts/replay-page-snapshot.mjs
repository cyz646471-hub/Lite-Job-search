import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { replayPageSnapshot } from '../src/application/replay-page-snapshot.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    values[token.slice(2)] = argv[index + 1];
    index += 1;
  }
  return values;
}

export async function replayPageSnapshotCli({
  databaseFile = 'data/lite-job-search.sqlite',
  snapshotId,
} = {}) {
  if (!snapshotId) throw new Error('--snapshot-id is required');
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.resolve(databaseFile),
  });
  try {
    repository.migrate();
    const snapshot = repository.listPageSnapshots({ limit: 5000 })
      .find((item) => item.id === snapshotId);
    if (!snapshot) throw new Error(`unknown PageSnapshot: ${snapshotId}`);
    return replayPageSnapshot({ snapshot });
  } finally {
    repository.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  replayPageSnapshotCli({
    databaseFile: args.database,
    snapshotId: args['snapshot-id'],
  }).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${JSON.stringify({
      status: 'FAILED',
      error: String(error?.message || error),
    })}\n`);
    process.exitCode = 2;
  });
}
