import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { studentHeaders, toStudentRow } from '../src/cli/student-workbook.mjs';
import { readRecords, writeRecords } from '../src/cli/io.mjs';

test('toStudentRow exposes only student-facing fields and keeps a verified apply link', () => {
  const row = toStudentRow({
    company: 'Acme',
    market: 'CN',
    recruitmentBatch: '2027 届校园招聘',
    location: '上海',
    recruitmentStartAt: '2026-07-01T08:00:00.000Z',
    roleCategories: ['研发', '产品'],
    applyUrl: 'https://jobs.acme.example/apply/123',
    applicationActive: true,
    discoveryEvidenceUrl: 'https://search.example/result',
    source: 'public-search',
  });

  assert.deepEqual(studentHeaders, [
    '公司', '市场', '招聘批次或岗位', '地点', '启动或发布时间', '岗位方向', '投递入口', '投递状态',
  ]);
  assert.deepEqual(row, [
    'Acme', 'CN', '2027 届校园招聘', '上海', new Date('2026-07-01T08:00:00.000Z'), '研发、产品',
    { text: '查看职位并投递', url: 'https://jobs.acme.example/apply/123' }, '在招',
  ]);
});

test('toStudentRow supports the persisted CN report shape without treating discovery evidence as an entry', () => {
  const row = toStudentRow({
    company: '示例科技',
    recruitmentBatch: '2026 社招',
    sourceUpdatedAt: '2026-07-15',
    roleCategories: ['工程'],
    recruitmentEntryUrl: 'https://careers.example/jobs',
    entryType: '官方招聘站或受委托 ATS',
    verificationStatus: 'partially_verified',
    discoveryEvidenceUrl: 'https://search.example/lead',
  }, { market: 'CN' });

  assert.deepEqual(row, [
    '示例科技', 'CN', '2026 社招', '', new Date('2026-07-15T00:00:00.000Z'), '工程',
    { text: '查看职位并投递', url: 'https://careers.example/jobs' }, '待确认',
  ]);
});

test('toStudentRow does not invent a link or an active status when source data is incomplete', () => {
  const row = toStudentRow({ company: 'No Link Inc.', verificationStatus: 'verified' }, { market: 'NA' });

  assert.deepEqual(row, [
    'No Link Inc.', 'NA', '', '', '', '', '', '已核验',
  ]);
});

test('readRecords accepts the persisted companies report shape and inherits its market', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-student-'));
  const input = path.join(directory, 'report.json');
  await writeFile(input, JSON.stringify({
    market: 'CN',
    companies: [{ company: 'Acme', recruitmentBatch: 'campus recruitment' }],
  }));

  assert.deepEqual(await readRecords(input), [{
    company: 'Acme', recruitmentBatch: 'campus recruitment', market: 'CN',
  }]);
});

test('writeRecords creates a real XLSX workbook for direct student export', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-student-'));
  const output = path.join(directory, 'student.xlsx');

  const summary = await writeRecords(output, [{
    company: 'Acme', market: 'NA', jobListUrl: 'https://acme.example/jobs', applicationActive: true,
  }], 'xlsx');

  assert.equal(summary.format, 'xlsx');
  assert.equal(summary.count, 1);
  assert.equal((await readFile(output)).subarray(0, 2).toString(), 'PK');
});
