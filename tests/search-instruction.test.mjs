import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compileSearchInstruction,
  parseFreshnessDays,
} from '../src/application/compile-search-instruction.mjs';

const NOW = new Date('2026-07-26T08:00:00.000Z');

test('compiles a Chinese product-manager instruction into a complete worker task', () => {
  const task = compileSearchInstruction(
    '检索近90天内中国，开放产品经理方向岗位公司100个',
    { now: () => NOW },
  );

  assert.equal(task.market, 'CN');
  assert.equal(task.countryRegion, '中国大陆');
  assert.equal(task.role, '产品经理');
  assert.equal(task.industry, '');
  assert.equal(task.location, '');
  assert.equal(task.freshnessDays, 90);
  assert.equal(task.targetCount, 100);
  assert.equal(task.browserMode, 'normal-chrome');
  assert.deepEqual(task.searchSources, ['chrome_baidu_visible_search']);
  assert.deepEqual(task.disabledSearchSources, ['baidu_api', 'apify']);
  assert.equal(task.maxCompaniesPerRun, 10);
  assert.match(task.batchId, /^instruction-cn-product-manager-20260726-[a-f0-9]{8}$/);
  assert.equal(
    task.registry,
    'data/company-registry/golden-seed-companies-merged-current.json',
  );
  assert.equal(task.database, 'data/lite-job-search.sqlite');
  assert.match(task.outputDir, /instruction-cn-product-manager-20260726-[a-f0-9]{8}$/);
  assert.match(task.xlsxOutput, /student-applications\.xlsx$/);
});

test('parses days, weeks and months without using an LLM', () => {
  assert.equal(parseFreshnessDays('近30天'), 30);
  assert.equal(parseFreshnessDays('最近4周'), 28);
  assert.equal(parseFreshnessDays('近3个月内'), 90);
});

test('compiles North America and an explicit location', () => {
  const task = compileSearchInstruction(
    '检索近2个月北美地区，在多伦多开放后端开发岗位的公司25家',
    { now: () => NOW },
  );

  assert.equal(task.market, 'NA');
  assert.equal(task.countryRegion, '美国和加拿大');
  assert.equal(task.role, '后端开发');
  assert.equal(task.location, '多伦多');
  assert.equal(task.freshnessDays, 60);
  assert.equal(task.targetCount, 25);
});

test('rejects instructions that omit a market, role or target count', () => {
  assert.throws(
    () => compileSearchInstruction('检索近90天产品经理公司100家'),
    /market/,
  );
  assert.throws(
    () => compileSearchInstruction('检索近90天中国公司100家'),
    /role/,
  );
  assert.throws(
    () => compileSearchInstruction('检索近90天中国产品经理岗位'),
    /target count/,
  );
});
