import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

import {
  createMarketDiscoveryRuntime,
  discoverMarketJobs,
} from '../src/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: path.join(root, '.env.local'), quiet: true });

const runtime = await createMarketDiscoveryRuntime({
  market: 'CN',
  databaseFile: process.env.LITE_JOB_DATABASE_FILE,
});

try {
  let result;
  if (!runtime.planningModel.configured) {
    result = {
      status: 'NOT_CONFIGURED',
      reason: 'LLM_PLANNING_NOT_CONFIGURED',
      liveSearchExecuted: false,
    };
  } else if (!runtime.providerOrder.some((provider) => provider?.configured)) {
    result = {
      status: 'NOT_CONFIGURED',
      reason: 'SEARCH_PROVIDER_NOT_CONFIGURED',
      liveSearchExecuted: false,
    };
  } else {
    result = await discoverMarketJobs({
      market: 'CN',
      roleType: 'AI 产品经理',
      industryTags: ['AI', '互联网'],
      freshnessDays: 90,
      targetCount: 20,
    }, runtime);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  const message = String(error?.message || error).slice(0, 240);
  const blocked = /captcha|验证码|access denied|forbidden|HTTP (?:401|403|429)/i.test(message);
  process.stdout.write(`${JSON.stringify({
    status: blocked ? 'BLOCKED' : 'ERROR',
    reason: blocked ? 'PUBLIC_ACCESS_BLOCKED' : 'CANARY_FAILED',
    liveSearchExecuted: true,
    error: message,
  }, null, 2)}\n`);
  if (!blocked) process.exitCode = 1;
} finally {
  runtime.close();
}
