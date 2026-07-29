import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolvePageProvider } from '../engine/upstream/planner/page-providers/_registry.mjs';
import { detectAtsFingerprint } from '../engine/upstream/planner/cn-ats-fingerprint.mjs';
import { extractDynamicRecruitmentJobs } from '../src/adapters/browser/dynamic-recruitment-site-adapter.mjs';
import { replayPageSnapshot } from '../src/application/replay-page-snapshot.mjs';
import { contentHashOfSnapshotBody } from '../src/domain/page-snapshot.mjs';

test('China ATS registry covers Moka, Beisen/iTalent, Feishu, Hotjob and Moseeker', async () => {
  const cases = [
    ['https://tenant.mokahr.cn/jobs', 'moka'],
    ['https://tenant.italent.cn/jobs', 'beisen-italent'],
    ['https://jobs.bytedance.com/campus', 'feishu-jobs'],
    ['https://tenant.hotjob.cn/jobs', 'hotjob'],
    ['https://tenant.moseeker.com/jobs', 'moseeker'],
  ];
  for (const [url, expected] of cases) {
    assert.equal((await resolvePageProvider(url))?.id, expected);
  }
});

test('ATS fingerprints identify iTalent, Feishu and Moseeker domains', () => {
  assert.equal(detectAtsFingerprint({ url: 'https://tenant.italent.cn/jobs' }).ats, 'Beisen');
  assert.equal(detectAtsFingerprint({ url: 'https://jobs.feishu.cn/company' }).ats, 'Feishu Recruitment');
  assert.equal(detectAtsFingerprint({ url: 'https://tenant.moseeker.cn/jobs' }).ats, 'Moseeker');
});

test('Moseeker dynamic fallback extracts visible job links without deciding identity', () => {
  const [job] = extractDynamicRecruitmentJobs({
    links: [{
      href: 'https://tenant.moseeker.com/position/123',
      text: 'AI 产品经理',
    }],
  }, {
    pageUrl: 'https://tenant.moseeker.com/jobs',
  });
  assert.equal(job.title, 'AI 产品经理');
  assert.equal(job.extractionAdapter, 'MOSEEKER');
});

test('stored PageSnapshot can be replayed without network access', async () => {
  const body = '<html><title>Campus jobs</title><a href="/position/123">AI PM</a></html>';
  const bodyPath = path.join(tmpdir(), `ljs-snapshot-${Date.now()}.html`);
  await writeFile(bodyPath, body, 'utf8');
  const result = await replayPageSnapshot({
    snapshot: {
      id: 'snapshot-1',
      sourceEndpointId: 'endpoint-1',
      bodyPath,
      finalUrl: 'https://tenant.moseeker.com/jobs',
      contentHash: contentHashOfSnapshotBody(body),
    },
  });
  assert.equal(result.provider, 'moseeker');
  assert.equal(result.contentHash, contentHashOfSnapshotBody(body));
});
