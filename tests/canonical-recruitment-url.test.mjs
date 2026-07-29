import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalRecruitmentUrl } from '../src/core/canonical-recruitment-url.mjs';

test('canonical recruitment URL removes tracking and directory filters', () => {
  assert.equal(
    canonicalRecruitmentUrl('https://Jobs.Example.com/openings/?department=product&amp;utm_source=search&sort=ctime#top'),
    'https://jobs.example.com/openings',
  );
});

test('canonical recruitment URL preserves tenant and job identity parameters', () => {
  assert.equal(
    canonicalRecruitmentUrl('https://ats.example.com/jobs?tenant=acme&jobId=42&utm_medium=web'),
    'https://ats.example.com/jobs?jobId=42&tenant=acme',
  );
});
