import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

function portable(value) {
  return String(value).split(path.sep).join('/');
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function listFiles(root, relativeDirectory) {
  const absoluteDirectory = path.resolve(root, relativeDirectory);
  if (!isInside(root, absoluteDirectory)) {
    throw new Error(`include directory is outside source root: ${relativeDirectory}`);
  }
  const files = [];
  const visit = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile()) files.push(portable(path.relative(root, absolute)));
    }
  };
  await visit(absoluteDirectory);
  return files;
}

export function parseRelativeImports(source = '') {
  const values = [];
  const code = String(source).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const rawLine of code.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, '');
    const patterns = [
      /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        if (match[1].startsWith('.')) values.push(match[1]);
      }
    }
  }
  return [...new Set(values)];
}

export async function buildImportClosure({
  sourceRoot,
  entrypoints = [],
  includeDirectories = [],
  excludePatterns = [],
} = {}) {
  const root = path.resolve(String(sourceRoot || ''));
  if (!root || !(await stat(root)).isDirectory()) {
    throw new Error(`source root is not a directory: ${sourceRoot}`);
  }
  const excluded = (relative) => excludePatterns.some((pattern) => portable(relative).includes(pattern));
  const queue = entrypoints.map(portable);
  for (const directory of includeDirectories) {
    queue.push(...await listFiles(root, directory));
  }

  const files = new Set();
  while (queue.length) {
    const relative = portable(queue.shift());
    if (!relative || files.has(relative) || excluded(relative)) continue;
    const absolute = path.resolve(root, relative);
    if (!isInside(root, absolute)) {
      throw new Error(`import is outside source root: ${relative}`);
    }
    const info = await stat(absolute).catch(() => null);
    if (!info?.isFile()) {
      throw new Error(`extraction dependency does not exist: ${relative}`);
    }
    files.add(relative);
    if (!/\.(?:mjs|cjs|js|json)$/i.test(relative)) continue;
    const source = await readFile(absolute, 'utf8');
    for (const specifier of parseRelativeImports(source)) {
      const imported = path.resolve(path.dirname(absolute), specifier);
      if (!isInside(root, imported)) {
        throw new Error(`import is outside source root: ${specifier} from ${relative}`);
      }
      queue.push(portable(path.relative(root, imported)));
    }
  }
  return [...files].sort();
}
