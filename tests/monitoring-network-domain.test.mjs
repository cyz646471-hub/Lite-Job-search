import assert from 'node:assert/strict';
import test from 'node:test';

import { createFetchObservation } from '../src/domain/fetch-observation.mjs';
import { createJobRevision } from '../src/domain/job-revision.mjs';
import { createMonitorPolicy } from '../src/domain/monitor-policy.mjs';
import { createSourceEndpoint } from '../src/domain/source-endpoint.mjs';

test('monitoring-network domain records are deterministic and validated', () => {
  const endpoint = createSourceEndpoint({
    companyId: 'company-1',
    careerPortalId: 'portal-1',
    url: 'https://jobs.example.com/#openings',
    endpointKind: 'JOB_LIST',
    intervalHours: 24,
  });
  const duplicate = createSourceEndpoint({
    companyId: 'company-1',
    url: 'https://jobs.example.com/',
  });
  assert.equal(endpoint.id, duplicate.id);
  assert.equal(endpoint.canonicalUrl, 'https://jobs.example.com/');

  const observation = createFetchObservation({
    sourceEndpointId: endpoint.id,
    outcome: 'NO_OPENINGS',
    pageRole: 'JOB_LIST',
    jobCount: 0,
  });
  assert.equal(observation.outcome, 'NO_OPENINGS');
  assert.throws(() => createFetchObservation({
    sourceEndpointId: endpoint.id,
    outcome: 'NO_OPENINGS',
    jobCount: 1,
  }), /cannot contain jobs/);

  const policy = createMonitorPolicy({
    targetType: 'SOURCE_ENDPOINT',
    targetId: endpoint.id,
    queueLane: 'PORTAL_MONITOR',
    consecutiveMissingThreshold: 1,
  });
  assert.equal(policy.consecutiveMissingThreshold, 2);
  assert.equal(policy.searchAllowed, false);

  const revision = createJobRevision({
    jobId: 'job-1',
    changeType: 'UPDATED',
    fields: { title: 'AI Product Manager' },
    changedFields: ['title'],
  });
  assert.match(revision.revisionHash, /^[a-f0-9]{64}$/);
});
