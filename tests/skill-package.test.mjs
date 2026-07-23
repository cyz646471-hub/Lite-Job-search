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
  for (const command of ['doctor', 'search', 'batch', 'verify', 'export']) {
    assert.match(content, new RegExp(`lite-job-search ${command}`));
  }
  assert.match(content, /中国|CN/);
  assert.match(content, /北美|North America/);
  assert.match(content, /验证码|CAPTCHA/);
  assert.match(content, /不得.*提交|never.*submit/i);
});

test('skill bundles runnable script and progressive market references', async () => {
  for (const relative of [
    'scripts/run-search.ps1',
    'references/china-market.md',
    'references/north-america-market.md',
    'references/data-contract.md',
  ]) {
    await access(new URL(relative, skillRoot));
  }
});

