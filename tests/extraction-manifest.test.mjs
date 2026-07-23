import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('extraction manifest covers CN, NA, shared providers and public entrypoints', async () => {
  const manifest = JSON.parse(await readFile(new URL('config/extraction-manifest.json', root), 'utf8'));
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(manifest.entrypoints.cn.some((value) => value.includes('cn-')));
  assert.ok(manifest.entrypoints.na.includes('scan.mjs'));
  assert.ok(manifest.entrypoints.shared.includes('providers/_registry.mjs'));
  assert.deepEqual(
    manifest.publicCommands.sort(),
    ['batch', 'doctor', 'export', 'search', 'verify'],
  );
});

test('extraction manifest excludes Career OP evaluation and application features', async () => {
  const manifest = JSON.parse(await readFile(new URL('config/extraction-manifest.json', root), 'utf8'));
  const serialized = JSON.stringify(manifest);
  for (const forbidden of [
    'generate-pdf',
    'prepare-application',
    'interview-prep',
    'salary-gap',
    'match-star',
    'tracker.mjs',
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace('.', '\\.')));
  }
});

