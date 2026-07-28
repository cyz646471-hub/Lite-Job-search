import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { prepareNewCompanyWatch } from '../scripts/prepare-new-company-watch.mjs';

test('new company watch preparation writes a runnable queue without mutating the database', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-new-company-watch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const watchlist = path.join(directory, 'watchlist.json');
  const queue = path.join(directory, 'queue.json');
  await writeFile(watchlist, JSON.stringify({
    companies: [{ company: 'Example New Company', market: 'CN', industry: 'AI' }],
  }));

  const plan = await prepareNewCompanyWatch({
    watchlistFile: watchlist,
    databaseFile: path.join(directory, 'jobs.sqlite'),
    outputFile: queue,
    now: '2026-07-29T00:00:00.000Z',
  });
  const persisted = JSON.parse(await readFile(queue, 'utf8'));
  assert.equal(plan.selectedCount, 1);
  assert.equal(persisted.companies[0].company, 'Example New Company');
  assert.deepEqual(persisted.companies[0].industry, ['AI']);
  assert.equal(persisted.companies[0].watchState, 'NEW_COMPANY');
});
