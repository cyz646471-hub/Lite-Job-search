import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import { runDiscoverCommand } from '../src/cli/discover.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.join(root, '.env.local'), quiet: true });

const result = await runDiscoverCommand({
  market: 'CN',
  role: 'AI 产品经理',
  industry: 'AI,互联网',
  sinceDays: 90,
  limit: 20,
  database: process.env.LITE_JOB_DATABASE_FILE,
});

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
