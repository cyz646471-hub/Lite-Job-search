#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const cli = path.join(projectRoot, 'bin', 'lite-job-search.mjs');
const args = process.argv.slice(2);
if (!args.length) {
  process.stderr.write('Usage: node run-search.mjs <doctor|search|batch|verify|export> [options]\n');
  process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  process.exitCode = result.status ?? 1;
}
