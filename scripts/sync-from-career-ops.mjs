#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildImportClosure } from '../src/extraction/import-graph.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

const sourceRoot = path.resolve(option(
  '--source',
  process.env.CAREER_OPS_SOURCE || path.resolve(projectRoot, '..', 'career-ops'),
));
const destination = path.resolve(projectRoot, 'engine', 'upstream');
if (!isInside(projectRoot, destination)) {
  throw new Error(`refusing to replace extraction destination outside project: ${destination}`);
}

const manifest = JSON.parse(await readFile(path.join(projectRoot, 'config', 'extraction-manifest.json'), 'utf8'));
const entrypoints = Object.values(manifest.entrypoints).flat();
const files = await buildImportClosure({
  sourceRoot,
  entrypoints,
  includeDirectories: manifest.includeDirectories,
  excludePatterns: manifest.excludePatterns,
});

await rm(destination, { recursive: true, force: true });
const records = [];
for (const relative of files) {
  const source = path.join(sourceRoot, relative);
  const target = path.join(destination, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  const body = await readFile(source);
  records.push({
    path: relative,
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
}

const extraction = {
  schemaVersion: 1,
  sourceProject: manifest.sourceProject,
  fileCount: records.length,
  files: records,
};
await mkdir(path.join(projectRoot, 'engine'), { recursive: true });
await writeFile(path.join(projectRoot, 'engine', 'manifest.json'), `${JSON.stringify(extraction, null, 2)}\n`);
console.log(JSON.stringify({
  status: 'ok',
  sourceRoot,
  destination,
  fileCount: records.length,
}));
