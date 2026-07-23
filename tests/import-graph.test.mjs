import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildImportClosure, parseRelativeImports } from '../src/extraction/import-graph.mjs';

test('parseRelativeImports returns static and literal dynamic imports only', () => {
  const source = `
    /**
     * Example only:
     * import { ignored } from './seeds/vc-portfolios.mjs';
     */
    import './a.mjs';
    export { value } from "../shared/b.mjs";
    const c = await import('./c.mjs');
    const ignored = await import(variable);
    import 'node:path';
  `;
  assert.deepEqual(
    parseRelativeImports(source),
    ['./a.mjs', '../shared/b.mjs', './c.mjs'],
  );
});

test('buildImportClosure follows transitive imports and directory bundles', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-graph-'));
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'providers'), { recursive: true });
  await writeFile(path.join(root, 'src', 'entry.mjs'), "import './nested/a.mjs';\n");
  await writeFile(path.join(root, 'src', 'nested', 'a.mjs'), "export { b } from '../b.mjs';\n");
  await writeFile(path.join(root, 'src', 'b.mjs'), 'export const b = 1;\n');
  await writeFile(path.join(root, 'providers', 'one.mjs'), 'export default {};\n');

  const files = await buildImportClosure({
    sourceRoot: root,
    entrypoints: ['src/entry.mjs'],
    includeDirectories: ['providers'],
  });

  assert.deepEqual(files, [
    'providers/one.mjs',
    'src/b.mjs',
    'src/entry.mjs',
    'src/nested/a.mjs',
  ]);
});

test('buildImportClosure rejects relative imports outside the source root', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'lite-job-search-boundary-'));
  const root = path.join(parent, 'source');
  await mkdir(root);
  await writeFile(path.join(root, 'entry.mjs'), "import '../secret.mjs';\n");
  await writeFile(path.join(parent, 'secret.mjs'), 'export const secret = true;\n');

  await assert.rejects(
    buildImportClosure({ sourceRoot: root, entrypoints: ['entry.mjs'] }),
    /outside source root/,
  );
});
