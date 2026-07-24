import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  studentHeaders,
  studentHyperlinkFormula,
  toStudentRow,
} from '../src/cli/student-workbook.mjs';
import { readRecords, writeRecords } from '../src/cli/io.mjs';

test('toStudentRow exposes only student-facing fields and keeps a verified apply link', () => {
  const row = toStudentRow({
    company: 'Acme',
    recruitmentBatch: '2027 届校园招聘',
    title: 'AI 产品经理',
    location: '上海',
    publishedAt: '2026-07-01T08:00:00.000Z',
    closesAt: '2026-08-31T23:59:59.000Z',
    companyTypePrediction: {
      label: '民营企业',
      confidence: 0.91,
      source: 'luna',
    },
    applyUrl: 'https://jobs.acme.example/apply/123',
    applicationActive: true,
    discoveryEvidenceUrl: 'https://search.example/result',
    source: 'public-search',
  });

  assert.deepEqual(studentHeaders, [
    '公司名称', '公司类型（模型判断）', '开放批次', '开放岗位',
    '地区', '开始时间', '截止时间', '投递链接',
  ]);
  assert.deepEqual(row, [
    'Acme', '民营企业', '2027 届校园招聘', 'AI 产品经理', '上海',
    new Date('2026-07-01T08:00:00.000Z'),
    new Date('2026-08-31T23:59:59.000Z'),
    { text: '查看岗位并投递', url: 'https://jobs.acme.example/apply/123' },
  ]);
});

test('toStudentRow supports the persisted CN report shape without treating discovery evidence as an entry', () => {
  const row = toStudentRow({
    company: '示例科技',
    recruitmentBatch: '2026 社招',
    title: '后端开发工程师',
    sourceUpdatedAt: '2026-07-15',
    deadlineType: 'until_filled',
    companyTypePrediction: {
      label: '民营企业',
      confidence: 0.62,
      source: 'luna',
    },
    recruitmentEntryUrl: 'https://careers.example/jobs',
    entryType: '官方招聘站或受委托 ATS',
    verificationStatus: 'partially_verified',
    discoveryEvidenceUrl: 'https://search.example/lead',
  }, { market: 'CN' });

  assert.deepEqual(row, [
    '示例科技', '待确认', '2026 社招', '后端开发工程师', '',
    new Date('2026-07-15T00:00:00.000Z'), '招满即止',
    { text: '查看岗位并投递', url: 'https://careers.example/jobs' },
  ]);
});

test('toStudentRow does not invent a link, date, or company type when source data is incomplete', () => {
  const row = toStudentRow({ company: 'No Link Inc.', verificationStatus: 'verified' }, { market: 'NA' });

  assert.deepEqual(row, [
    'No Link Inc.', '待确认', '待确认', '', '', '未披露', '未披露', '',
  ]);
});

test('studentHyperlinkFormula keeps an Excel hyperlink and a renderer-safe label', () => {
  assert.equal(
    studentHyperlinkFormula({
      text: '查看岗位并投递',
      url: 'https://jobs.example.com/search?q="AI"',
    }),
    '=IFERROR(HYPERLINK("https://jobs.example.com/search?q=""AI""","查看岗位并投递"),"查看岗位并投递")',
  );
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
