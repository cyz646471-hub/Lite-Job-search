import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const skillRoot = new URL('../.agents/skills/lite-job-search/', import.meta.url);

test('skill has complete metadata and no scaffold placeholders', async () => {
  const content = await readFile(new URL('SKILL.md', skillRoot), 'utf8');
  assert.match(content, /^---\r?\nname: lite-job-search\r?\ndescription: .+\r?\n---/);
  assert.doesNotMatch(content, /TODO|Structuring This Skill/);
});

test('skill documents every CLI workflow and safety boundary', async () => {
  const content = await readFile(new URL('SKILL.md', skillRoot), 'utf8');
  for (const command of ['doctor', 'search', 'batch', 'verify', 'export', 'discover', 'discover-batch']) {
    assert.match(content, new RegExp(`lite-job-search ${command}`));
  }
  assert.match(content, /中国|CN/);
  assert.match(content, /北美|North America/);
  assert.match(content, /验证码|CAPTCHA/);
  assert.match(content, /不得.*提交|never.*submit/i);
  assert.match(content, /LLM.*关键词.*Query/s);
  assert.match(content, /不能.*官网真实性/s);
  assert.match(content, /SQLite/);
  assert.match(content, /NOT_CONFIGURED/);
  assert.match(content, /quality/i);
  assert.match(content, /retry-failed/);
});

test('skill bundles runnable script and progressive market references', async () => {
  for (const relative of [
    'scripts/run-search.mjs',
    'scripts/run-search.ps1',
    'references/china-market.md',
    'references/north-america-market.md',
    'references/data-contract.md',
  ]) {
    await access(new URL(relative, skillRoot));
  }
});

test('skill data contract documents role-driven market entities', async () => {
  const content = await readFile(new URL('references/data-contract.md', skillRoot), 'utf8');
  for (const model of ['Company', 'CareerPortal', 'JobOpening', 'DiscoveryLog']) {
    assert.match(content, new RegExp(model));
  }
  assert.match(content, /XLSX/);
  assert.match(content, /超链接/);
});
