export const CIRCUIT_STATES = Object.freeze([
  'CLOSED',
  'OPEN',
  'PROBE_REQUIRED',
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
    openedAt: null,
    nextProbeAt: null,
    lastHealthyAt: null,
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
      openedAt: current.openedAt || now,
      nextProbeAt: event.nextProbeAt || null,
      lastHealthyAt: current.lastHealthyAt || null,
      updatedAt: now,
    });
  }
  if (event.type === 'MANUAL_RESUME_REQUESTED') {
    return Object.freeze({
      ...current,
      state: 'PROBE_REQUIRED',
      updatedAt: now,
    });
  }
  if (event.type === 'HEALTHY_PROBE') {
    return Object.freeze({
      ...current,
      state: 'CLOSED',
      reasonCode: null,
      openedAt: null,
      nextProbeAt: null,
      lastHealthyAt: now,
      updatedAt: now,
    });
  }
  return current;
}

export function createAdaptiveSearchIntervalGate({
  minimumIntervalMs = 10_000,
  jitterMs = 20_000,
  random = Math.random,
  nowMs = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  const minimum = Math.max(10_000, Number(minimumIntervalMs) || 10_000);
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
} = {}, {
  repository,
  now = () => new Date().toISOString(),
} = {}) {
  if (!repository
    || typeof repository.getProviderCircuitState !== 'function'
    || typeof repository.saveProviderCircuitState !== 'function') {
    throw new Error('circuit repository is required');
  }
  if (typeof healthProbe !== 'function') {
    throw new Error('healthProbe is required');
  }
  const normalizedProvider = requireProvider(provider);
  const current = repository.getProviderCircuitState(normalizedProvider)
    || createClosedCircuit(normalizedProvider, now());
  const probeRequired = transitionCircuit(current, {
    type: 'MANUAL_RESUME_REQUESTED',
  }, now());
  repository.saveProviderCircuitState(probeRequired);

  let probe;
  try {
    probe = await healthProbe();
  } catch (error) {
    probe = {
      healthy: false,
      reasonCode: String(error?.message || error || 'health_probe_failed').slice(0, 120),
    };
  }
  const next = probe?.healthy === true
    ? transitionCircuit(probeRequired, { type: 'HEALTHY_PROBE' }, now())
    : transitionCircuit(probeRequired, {
      type: 'BLOCKED',
      reasonCode: probe?.reasonCode || 'health_probe_failed',
    }, now());
  return repository.saveProviderCircuitState(next);
}
