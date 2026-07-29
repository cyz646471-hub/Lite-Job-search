import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateJobPublication } from '../src/domain/job-publication.mjs';

const portal = {
  sourceTier: 'OFFICIAL_SITE',
  verificationStatus: 'VERIFIED',
  officialIdentityConfirmed: true,
  lastVerifiedAt: '2026-07-28T00:00:00.000Z',
};
const event = {
  id: 'event-1',
  sourceTier: 'OFFICIAL_SITE',
  status: 'OPEN',
  directoryUrl: 'https://jobs.example.com/campus',
  locations: [],
};
const opening = {
  sourceTier: 'OFFICIAL_SITE',
  status: 'ACTIVE',
  title: '产品经理',
  locations: ['上海'],
};

test('publication policy grants A only to complete verified official openings', () => {
  assert.deepEqual(evaluateJobPublication({ opening, portal, event }), {
    qualityGrade: 'A',
    publicationStatus: 'PUBLISHED',
    reasons: [],
    applicationVerifiedAt: portal.lastVerifiedAt,
  });
});

test('publication policy routes incomplete official openings to B review', () => {
  const result = evaluateJobPublication({
    opening: { ...opening, locations: [] },
    portal,
    event: { ...event, locations: [] },
  });
  assert.equal(result.qualityGrade, 'B');
  assert.equal(result.publicationStatus, 'REVIEW_REQUIRED');
  assert.deepEqual(result.reasons, ['LOCATION_MISSING']);
});

test('publication policy requires a recruitment event before formal release', () => {
  const result = evaluateJobPublication({
    opening,
    portal,
    event: {},
  });
  assert.equal(result.qualityGrade, 'B');
  assert.equal(result.publicationStatus, 'REVIEW_REQUIRED');
  assert.ok(result.reasons.includes('RECRUITMENT_EVENT_MISSING'));
});

test('publication policy never publishes platform-only openings', () => {
  const result = evaluateJobPublication({
    opening: { ...opening, sourceTier: 'PLATFORM_ONLY' },
    portal: { ...portal, sourceTier: 'PLATFORM_ONLY', officialIdentityConfirmed: false },
    event: { ...event, sourceTier: 'PLATFORM_ONLY' },
  });
  assert.deepEqual(result, {
    qualityGrade: 'C',
    publicationStatus: 'REVIEW_REQUIRED',
    reasons: ['PLATFORM_ONLY_SOURCE'],
    applicationVerifiedAt: portal.lastVerifiedAt,
  });
});
