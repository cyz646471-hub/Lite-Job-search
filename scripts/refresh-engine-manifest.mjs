import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const upstream = path.join(root, 'engine', 'upstream');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile() && !entry.name.endsWith('.bak')) files.push(absolute);
  }
  return files;
}

const files = (await walk(upstream)).sort();
const records = [];
for (const file of files) {
  const body = await readFile(file);
  records.push({
    path: path.relative(upstream, file).replaceAll('\\', '/'),
    bytes: body.byteLength,
    sha256: createHash('sha256').update(body).digest('hex'),
  });
}
const manifest = {
  schemaVersion: 1,
  sourceProject: 'career-ops',
  fileCount: records.length,
  files: records,
};
await writeFile(
  path.join(root, 'engine', 'manifest.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);
