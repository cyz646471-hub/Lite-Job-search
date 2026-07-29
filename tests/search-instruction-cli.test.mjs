import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { createCompany } from '../src/domain/company.mjs';
import { openSqliteMarketDiscoveryRepository } from '../src/storage/sqlite-job-repository.mjs';

test('plan-only compiles an instruction and excludes companies already in SQLite', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-instruction-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, 'registry.json');
  const database = path.join(directory, 'jobs.sqlite');
  const outputDir = path.join(directory, 'output');
  await writeFile(registry, `${JSON.stringify([
    { company: '已收录公司', aliases: ['Known Co'] },
    { company: '候选甲公司', officialDomain: 'candidate-a.example' },
    { company: '候选乙公司' },
  ])}\n`);

  const repository = openSqliteMarketDiscoveryRepository({ file: database });
  repository.migrate();
  repository.upsertCompany(createCompany({
    id: 'known-company',
    canonicalName: 'Known Co',
    aliases: [],
    officialDomains: [],
    industry: [],
    market: 'CN',
  }));
  repository.close();

  const result = spawnSync(process.execPath, [
    'scripts/run-search-instruction.mjs',
    '检索近90天内中国，开放产品经理方向岗位公司2个',
    '--registry', registry,
    '--database', database,
    '--output-dir', outputDir,
    '--plan-only',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.status, 'PLANNED');
  assert.equal(response.selectedCompanies, 2);

  const manifest = JSON.parse(await readFile(
    path.join(outputDir, 'task-manifest.json'),
    'utf8',
  ));
  const selected = JSON.parse(await readFile(
    path.join(outputDir, 'selected-companies.json'),
    'utf8',
  ));
  assert.equal(manifest.task.market, 'CN');
  assert.equal(manifest.task.role, '产品经理');
  assert.equal(manifest.selection.excludedKnown, 1);
  assert.deepEqual(selected.map((item) => item.company), [
    '候选甲公司',
    '候选乙公司',
  ]);
  await assert.rejects(
    readFile(path.join(outputDir, 'run-report.json'), 'utf8'),
    /ENOENT/,
  );
});

test('plan-only reports a truthful local-list shortage without a supplement module', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-shortage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, 'registry.json');
  const database = path.join(directory, 'jobs.sqlite');
  const outputDir = path.join(directory, 'output');
  await writeFile(registry, '[{"company":"唯一候选"}]\n');

  const result = spawnSync(process.execPath, [
    'scripts/run-search-instruction.mjs',
    '检索近90天内中国，开放产品经理方向岗位公司3个',
    '--registry', registry,
    '--database', database,
    '--output-dir', outputDir,
    '--plan-only',
    '--no-registry-scan',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.status, 'PLANNED_WITH_SHORTAGE');
  assert.equal(response.selectedCompanies, 1);
  assert.equal(response.shortage, 2);
  assert.equal(response.supplementStatus, 'NOT_CONFIGURED');
});

test('China instruction accepts the configured persistent Chrome worker mode', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lite-job-browser-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const registry = path.join(directory, 'registry.json');
  const database = path.join(directory, 'jobs.sqlite');
  const outputDir = path.join(directory, 'output');
  await writeFile(registry, '[{"company":"候选公司"}]\n');

  const result = spawnSync(process.execPath, [
    'scripts/run-search-instruction.mjs',
    '检索近90天内中国，开放产品经理方向岗位公司1个',
    '--registry', registry,
    '--database', database,
    '--output-dir', outputDir,
    '--browser-mode', 'persistent-chrome',
    '--plan-only',
    '--no-registry-scan',
  ], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const response = JSON.parse(result.stdout.trim());
  assert.equal(response.status, 'PLANNED');
});
