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

test('manual resume requires a healthy probe before closing the circuit', () => {
  const opened = transitionCircuit(createClosedCircuit('baidu', NOW), {
    type: 'BLOCKED',
    reasonCode: 'search_challenge_or_access_blocked',
  }, NOW);
  const probeRequired = transitionCircuit(opened, {
    type: 'MANUAL_RESUME_REQUESTED',
  }, '2026-07-26T00:10:00.000Z');
  const closed = transitionCircuit(probeRequired, {
    type: 'HEALTHY_PROBE',
  }, '2026-07-26T00:11:00.000Z');

  assert.equal(probeRequired.state, 'PROBE_REQUIRED');
  assert.equal(closed.state, 'CLOSED');
  assert.equal(closed.reasonCode, null);
  assert.equal(closed.lastHealthyAt, '2026-07-26T00:11:00.000Z');
});

test('rate controller uses at least ten seconds plus bounded jitter', async () => {
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

  assert.deepEqual(delays, [20_000]);
});

test('provider resume persists CLOSED only after a healthy probe', async () => {
  let stored = transitionCircuit(createClosedCircuit('baidu', NOW), {
    type: 'BLOCKED',
    reasonCode: 'search_challenge_or_access_blocked',
  }, NOW);
  const repository = {
    getProviderCircuitState: () => stored,
    saveProviderCircuitState: (next) => {
      stored = next;
      return stored;
    },
  };

  const failed = await resumeProviderCircuit({
    provider: 'baidu',
    healthProbe: async () => ({ healthy: false, reasonCode: 'challenge_visible' }),
  }, { repository, now: () => '2026-07-26T00:10:00.000Z' });
  assert.equal(failed.state, 'OPEN');

  const healthy = await resumeProviderCircuit({
    provider: 'baidu',
    healthProbe: async () => ({ healthy: true }),
  }, { repository, now: () => '2026-07-26T00:11:00.000Z' });
  assert.equal(healthy.state, 'CLOSED');
});
