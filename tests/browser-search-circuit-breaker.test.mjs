import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAdaptiveSearchIntervalGate,
  createClosedCircuit,
  resumeProviderCircuit,
  transitionCircuit,
} from '../src/application/browser-search-circuit-breaker.mjs';

const NOW = '2026-07-26T00:00:00.000Z';

test('Baidu challenge opens the circuit without inventing a retry time', () => {
  const current = createClosedCircuit('baidu', NOW);
  const opened = transitionCircuit(current, {
    type: 'BLOCKED',
    reasonCode: 'search_challenge_or_access_blocked',
  }, NOW);

  assert.equal(opened.state, 'OPEN');
  assert.equal(opened.reasonCode, 'search_challenge_or_access_blocked');
  assert.equal(opened.openedAt, NOW);
  assert.equal(opened.nextProbeAt, null);
});

test('manual acknowledgement requires one HALF_OPEN probe before closing the circuit', () => {
  const opened = transitionCircuit(createClosedCircuit('baidu', NOW), {
    type: 'BLOCKED',
    reasonCode: 'search_challenge_or_access_blocked',
  }, NOW);
  const acknowledged = transitionCircuit(opened, {
    type: 'MANUAL_ACKNOWLEDGED',
  }, '2026-07-26T00:10:00.000Z');
  const halfOpen = transitionCircuit(acknowledged, {
    type: 'PROBE_LEASE_ACQUIRED',
    ownerId: 'worker-1',
    leaseUntil: '2026-07-26T00:12:00.000Z',
  }, '2026-07-26T00:10:30.000Z');
  const closed = transitionCircuit(halfOpen, {
    type: 'HEALTHY_PROBE',
  }, '2026-07-26T00:11:00.000Z');

  assert.equal(acknowledged.state, 'OPEN');
  assert.equal(halfOpen.state, 'HALF_OPEN');
  assert.equal(halfOpen.probeOwnerId, 'worker-1');
  assert.equal(closed.state, 'CLOSED');
  assert.equal(closed.reasonCode, null);
  assert.equal(closed.lastHealthyAt, '2026-07-26T00:11:00.000Z');
});

test('rate controller uses at least four seconds plus bounded jitter', async () => {
  let clock = 0;
  const delays = [];
  const gate = createAdaptiveSearchIntervalGate({
    minimumIntervalMs: 1_000,
    jitterMs: 20_000,
    random: () => 0.5,
    sleep: async (value) => {
      delays.push(value);
      clock += value;
    },
    nowMs: () => clock,
  });

  await gate();
  await gate();

  assert.deepEqual(delays, [14_000]);
});

test('provider resume persists CLOSED only after a healthy probe', async () => {
  let stored = transitionCircuit(createClosedCircuit('baidu', NOW), {
    type: 'BLOCKED',
    reasonCode: 'search_challenge_or_access_blocked',
  }, NOW);
  const repository = {
    getProviderCircuitState: () => stored,
    acknowledgeProviderCircuit: ({ acknowledgedAt }) => {
      stored = transitionCircuit(stored, {
        type: 'MANUAL_ACKNOWLEDGED',
      }, acknowledgedAt);
      return stored;
    },
    acquireProviderProbeLease: ({ ownerId, acquiredAt, leaseUntil }) => {
      if (stored.state !== 'OPEN') return null;
      stored = transitionCircuit(stored, {
        type: 'PROBE_LEASE_ACQUIRED',
        ownerId,
        leaseUntil,
      }, acquiredAt);
      return stored;
    },
    completeProviderProbe: ({ ownerId, healthy, reasonCode, completedAt }) => {
      assert.equal(stored.probeOwnerId, ownerId);
      stored = transitionCircuit(stored, healthy
        ? { type: 'HEALTHY_PROBE' }
        : { type: 'BLOCKED', reasonCode }, completedAt);
      return stored;
    },
  };
  repository.acknowledgeProviderCircuit({
    acknowledgedAt: '2026-07-26T00:09:00.000Z',
  });

  const failed = await resumeProviderCircuit({
    provider: 'baidu',
    ownerId: 'worker-failed',
    healthProbe: async () => ({ healthy: false, reasonCode: 'challenge_visible' }),
  }, { repository, now: () => '2026-07-26T00:10:00.000Z' });
  assert.equal(failed.state, 'OPEN');

  repository.acknowledgeProviderCircuit({
    acknowledgedAt: '2026-07-26T00:10:30.000Z',
  });
  const healthy = await resumeProviderCircuit({
    provider: 'baidu',
    ownerId: 'worker-healthy',
    healthProbe: async () => ({ healthy: true }),
  }, { repository, now: () => '2026-07-26T00:11:00.000Z' });
  assert.equal(healthy.state, 'CLOSED');
});
