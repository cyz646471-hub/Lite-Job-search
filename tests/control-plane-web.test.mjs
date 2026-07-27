import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';
import { createControlPlaneServer } from '../src/web/control-plane-server.mjs';

test('local web control plane reads real SQLite state and confirms writes', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-web-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  const record = path.join(directory, 'record.md');
  await writeFile(record, '# Development Record\n');
  const server = createControlPlaneServer({
    repository,
    developmentRecordPath: record,
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const input = {
    role_keywords: ['AI产品经理'],
    absolute_date_from: '2026-04-27',
    absolute_date_to: '2026-07-27',
    target_count: 10,
    selection_mode: 'NEW_COMPANIES_ONLY',
    target_unit: 'COMPANIES_PROCESSED',
    allow_baidu_fallback: false,
  };
  const denied = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  assert.equal(denied.status, 409);

  const createdResponse = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ljs-confirm': 'yes',
    },
    body: JSON.stringify(input),
  });
  assert.equal(createdResponse.status, 201);
  const task = await createdResponse.json();
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.tasks[0].id, task.id);
  assert.equal(status.batches[0].status, 'PENDING');

  const stopped = await fetch(`${base}/api/batches/${task.batchId}/stop`, {
    method: 'POST',
    headers: { 'x-ljs-confirm': 'yes' },
  });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).status, 'STOP_REQUESTED');
  assert.equal(
    await (await fetch(`${base}/api/development-record`)).text(),
    '# Development Record\n',
  );
  assert.equal((await fetch(`${base}/api/export`)).status, 404);
});
