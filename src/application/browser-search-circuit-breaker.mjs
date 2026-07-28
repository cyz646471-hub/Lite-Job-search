export const CIRCUIT_STATES = Object.freeze([
  'CLOSED',
  'OPEN',
  'HALF_OPEN',
]);

function requireProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (!normalized) throw new Error('circuit provider is required');
  return normalized;
}

export function createClosedCircuit(provider, now = new Date().toISOString()) {
  return Object.freeze({
    provider: requireProvider(provider),
    state: 'CLOSED',
    reasonCode: null,
    openedReason: null,
    openedAt: null,
    openUntil: null,
    nextProbeAt: null,
    lastHealthyAt: null,
    manualActionRequired: false,
    manualAcknowledgedAt: null,
    probeOwnerId: null,
    probeLeaseUntil: null,
    lastProbeAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    version: 0,
    updatedAt: now,
  });
}

export function transitionCircuit(current, event = {}, now = new Date().toISOString()) {
  if (!current || !CIRCUIT_STATES.includes(current.state)) {
    throw new Error('valid current circuit state is required');
  }
  if (event.type === 'BLOCKED') {
    return Object.freeze({
      provider: current.provider,
      state: 'OPEN',
      reasonCode: event.reasonCode || 'provider_blocked',
      openedReason: event.reasonCode || 'provider_blocked',
      openedAt: current.openedAt || now,
      openUntil: event.openUntil || null,
      nextProbeAt: event.nextProbeAt || null,
      lastHealthyAt: current.lastHealthyAt || null,
      manualActionRequired: true,
      manualAcknowledgedAt: null,
      probeOwnerId: null,
      probeLeaseUntil: null,
      lastProbeAt: current.lastProbeAt || null,
      lastSuccessAt: current.lastSuccessAt || current.lastHealthyAt || null,
      consecutiveFailures: (Number(current.consecutiveFailures) || 0) + 1,
      version: (Number(current.version) || 0) + 1,
      updatedAt: now,
    });
  }
  if (event.type === 'MANUAL_ACKNOWLEDGED') {
    return Object.freeze({
      ...current,
      manualAcknowledgedAt: now,
      version: (Number(current.version) || 0) + 1,
      updatedAt: now,
    });
  }
  if (event.type === 'PROBE_LEASE_ACQUIRED') {
    return Object.freeze({
      ...current,
      state: 'HALF_OPEN',
      probeOwnerId: event.ownerId,
      probeLeaseUntil: event.leaseUntil,
      lastProbeAt: now,
      version: (Number(current.version) || 0) + 1,
      updatedAt: now,
    });
  }
  if (event.type === 'HEALTHY_PROBE') {
    return Object.freeze({
      ...current,
      state: 'CLOSED',
      reasonCode: null,
      openedReason: null,
      openedAt: null,
      openUntil: null,
      nextProbeAt: null,
      lastHealthyAt: now,
      lastSuccessAt: now,
      manualActionRequired: false,
      manualAcknowledgedAt: null,
      probeOwnerId: null,
      probeLeaseUntil: null,
      consecutiveFailures: 0,
      version: (Number(current.version) || 0) + 1,
      updatedAt: now,
    });
  }
  return current;
}

export function createAdaptiveSearchIntervalGate({
  minimumIntervalMs = 4_000,
  jitterMs = 20_000,
  random = Math.random,
  nowMs = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const minimum = Math.max(4_000, Number(minimumIntervalMs) || 4_000);
  const jitter = Math.max(0, Number(jitterMs) || 0);
  let lastSearchStartedAt = null;
  return async function waitForSearchSlot() {
    const boundedRandom = Math.min(1, Math.max(0, Number(random()) || 0));
    const targetInterval = minimum + Math.floor(boundedRandom * jitter);
    const current = Number(nowMs());
    if (lastSearchStartedAt !== null) {
      const remaining = Math.max(0, targetInterval - (current - lastSearchStartedAt));
      if (remaining > 0) await sleep(remaining);
    }
    lastSearchStartedAt = Number(nowMs());
  };
}

export async function resumeProviderCircuit({
  provider,
  healthProbe,
  ownerId,
  leaseMs = 60_000,
} = {}, {
  repository,
  now = () => new Date().toISOString(),
} = {}) {
  if (!repository
    || typeof repository.getProviderCircuitState !== 'function'
    || typeof repository.acquireProviderProbeLease !== 'function'
    || typeof repository.completeProviderProbe !== 'function') {
    throw new Error('circuit repository is required');
  }
  if (typeof healthProbe !== 'function') {
    throw new Error('healthProbe is required');
  }
  const normalizedProvider = requireProvider(provider);
  const probeOwnerId = String(ownerId || '').trim();
  if (!probeOwnerId) throw new Error('ownerId is required');
  const current = repository.getProviderCircuitState(normalizedProvider);
  if (!current || current.state !== 'OPEN' || !current.manualAcknowledgedAt) {
    const error = new Error('manual acknowledgement is required before a health probe');
    error.code = 'MANUAL_ACK_REQUIRED';
    throw error;
  }
  const acknowledgedAt = now();
  const leaseUntil = new Date(
    Date.parse(acknowledgedAt) + Math.max(1_000, Number(leaseMs) || 60_000),
  ).toISOString();
  const lease = repository.acquireProviderProbeLease({
    provider: normalizedProvider,
    ownerId: probeOwnerId,
    acquiredAt: acknowledgedAt,
    leaseUntil,
  });
  if (!lease) {
    return Object.freeze({
      provider: normalizedProvider,
      state: 'HALF_OPEN',
      status: 'PROBE_ALREADY_OWNED',
    });
  }

  let probe;
  try {
    probe = await healthProbe();
  } catch (error) {
    probe = {
      healthy: false,
      reasonCode: String(error?.message || error || 'health_probe_failed').slice(0, 120),
    };
  }
  return repository.completeProviderProbe({
    provider: normalizedProvider,
    ownerId: probeOwnerId,
    healthy: probe?.healthy === true,
    reasonCode: probe?.reasonCode || 'health_probe_failed',
    completedAt: now(),
  });
}
