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
  assert.deepEqual(status.reviewTasks, []);
  const progress = await (await fetch(`${base}/api/progress`)).json();
  assert.equal(progress.task.id, task.id);
  assert.equal(progress.progress.target, 10);
  assert.equal(progress.progress.notMaterialized, 10);
  repository.ensureBatchItem({
    batchId: task.batchId,
    itemKey: 'company-cn',
    position: 0,
    input: {
      company: '国内示例公司',
      market: 'CN',
      countryRegion: 'China',
    },
    createdAt: '2026-07-27T00:00:00.000Z',
  });
  const companies = await (await fetch(`${base}/api/progress/companies`)).json();
  assert.equal(companies.total, 1);
  assert.equal(companies.items[0].company, '国内示例公司');
  const dashboard = await (await fetch(base)).text();
  assert.match(dashboard, /全量补齐看板/);
  assert.match(dashboard, /尚未装载/);

  const reviewResponse = await fetch(`${base}/api/reviews`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ljs-confirm': 'yes',
    },
    body: JSON.stringify({
      id: 'review-1',
      reviewType: 'PORTAL_VERIFICATION',
      targetType: 'COMPANY',
      targetId: 'company-1',
      reasonCodes: ['OFFICIAL_ENTRY_MISSING'],
    }),
  });
  assert.equal(reviewResponse.status, 201);
  const reviews = await (await fetch(`${base}/api/reviews?status=OPEN`)).json();
  assert.equal(reviews[0].id, 'review-1');

  const actionResponse = await fetch(`${base}/api/actions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ljs-confirm': 'yes',
    },
    body: JSON.stringify({
      id: 'action-1',
      actorId: 'planner-1',
      actionType: 'VIEWED',
    }),
  });
  assert.equal(actionResponse.status, 201);
  assert.equal((await (await fetch(`${base}/api/actions?actor_id=planner-1`)).json())[0].id, 'action-1');

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

test('control plane builds current student and company exports on download', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ljs-web-export-'));
  const repository = openSqliteMarketDiscoveryRepository({
    file: path.join(directory, 'jobs.sqlite'),
  });
  repository.migrate();
  const record = path.join(directory, 'record.md');
  const student = path.join(directory, 'student-current.xlsx');
  const companies = path.join(directory, 'companies-current.xlsx');
  await Promise.all([
    writeFile(record, '# Development Record\n'),
    writeFile(student, 'student-current'),
    writeFile(companies, 'companies-current'),
  ]);
  let studentBuilds = 0;
  let companyBuilds = 0;
  const server = createControlPlaneServer({
    repository,
    developmentRecordPath: record,
    buildStudentWorkbook: async () => {
      studentBuilds += 1;
      return { outputFile: student, rowCount: 7 };
    },
    buildCompanyWorkbook: async () => {
      companyBuilds += 1;
      return { outputFile: companies, rowCount: 123 };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    repository.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const studentResponse = await fetch(`${base}/api/export`);
  const companyResponse = await fetch(`${base}/api/export/companies`);

  assert.equal(studentResponse.status, 200);
  assert.equal(studentResponse.headers.get('x-ljs-row-count'), '7');
  assert.equal(await studentResponse.text(), 'student-current');
  assert.equal(companyResponse.status, 200);
  assert.equal(companyResponse.headers.get('x-ljs-row-count'), '123');
  assert.equal(await companyResponse.text(), 'companies-current');
  assert.equal(studentBuilds, 1);
  assert.equal(companyBuilds, 1);
});
