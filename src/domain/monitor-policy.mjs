import { createHash } from 'node:crypto';

export const MONITOR_TARGET_TYPES = Object.freeze([
  'COMPANY',
  'CAREER_PORTAL',
  'SOURCE_ENDPOINT',
]);

export const MONITOR_QUEUE_LANES = Object.freeze([
  'PORTAL_MONITOR',
  'PORTAL_RECOVERY',
  'MARKET_DISCOVERY',
  'REVIEW_FEEDBACK',
]);

export const MONITOR_SCHEDULE_CLASSES = Object.freeze([
  'RECRUITING_SEASON',
  'STANDARD',
  'LOW_FREQUENCY',
  'ON_DEMAND',
]);

export function stableMonitorPolicyId({ targetType, targetId }) {
  const digest = createHash('sha256')
    .update(`${String(targetType || '')}|${String(targetId || '')}`)
    .digest('hex')
    .slice(0, 24);
  return `policy-${digest}`;
}
export function createMonitorPolicy(input = {}, {
  now = new Date().toISOString(),
} = {}) {
  const targetType = String(input.targetType || '').trim().toUpperCase();
  const targetId = String(input.targetId || '').trim();
  const queueLane = String(input.queueLane || '').trim().toUpperCase();
  const scheduleClass = String(input.scheduleClass || 'STANDARD').trim().toUpperCase();
  if (!MONITOR_TARGET_TYPES.includes(targetType) || !targetId) {
    throw new Error('MonitorPolicy supported targetType and targetId are required');
  }
  if (!MONITOR_QUEUE_LANES.includes(queueLane)) {
    throw new Error('unsupported MonitorPolicy queueLane');
  }
  if (!MONITOR_SCHEDULE_CLASSES.includes(scheduleClass)) {
    throw new Error('unsupported MonitorPolicy scheduleClass');
  }
  return Object.freeze({
    id: String(input.id || stableMonitorPolicyId({ targetType, targetId })),
    targetType,
    targetId,
    queueLane,
    priority: Math.max(0, Math.min(100, Math.trunc(Number(input.priority) || 50))),
    scheduleClass,
    intervalHours: Math.max(1, Math.trunc(Number(input.intervalHours) || 168)),
    browserAllowed: input.browserAllowed === true,
    searchAllowed: input.searchAllowed === true,
    consecutiveMissingThreshold: Math.max(
      2,
      Math.trunc(Number(input.consecutiveMissingThreshold) || 3),
    ),
    lastScheduledAt: input.lastScheduledAt || null,
    nextDueAt: input.nextDueAt || null,
    enabled: input.enabled !== false,
    reason: input.reason || null,
    studentInterestCount: Math.max(
      0,
      Math.trunc(Number(input.studentInterestCount) || 0),
    ),
    historicalApplicationScore: Math.max(
      0,
      Number(input.historicalApplicationScore) || 0,
    ),
    lastOutcome: input.lastOutcome || null,
    priorityReasons: Object.freeze([...(input.priorityReasons || [])]),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
}

export function deriveMonitorSchedule({
  hiringAvailability = 'UNKNOWN',
  outcome = null,
  consecutiveFailures = 0,
  studentInterestCount = 0,
  historicalApplicationScore = 0,
  recruitingSeason = false,
} = {}) {
  const failed = ['BLOCKED', 'FAILED'].includes(outcome);
  if (failed) {
    const delay = Math.min(
      24 * 7,
      Math.max(4, 2 ** Math.min(7, Math.max(1, consecutiveFailures))),
    );
    return Object.freeze({
      queueLane: 'PORTAL_RECOVERY',
      scheduleClass: 'ON_DEMAND',
      intervalHours: delay,
      priority: outcome === 'BLOCKED' ? 75 : 65,
      browserAllowed: true,
      reasons: Object.freeze([`${String(outcome).toLowerCase()}_backoff`]),
    });
  }

  const interested = studentInterestCount > 0 || historicalApplicationScore > 0;
  if (hiringAvailability === 'OPENINGS_FOUND' || recruitingSeason || interested) {
    const intervalHours = studentInterestCount >= 5 || historicalApplicationScore >= 5
      ? 24
      : 48;
    return Object.freeze({
      queueLane: 'PORTAL_MONITOR',
      scheduleClass: 'RECRUITING_SEASON',
      intervalHours,
      priority: interested ? 95 : 90,
      browserAllowed: false,
      reasons: Object.freeze([
        hiringAvailability === 'OPENINGS_FOUND' ? 'openings_found' : null,
        recruitingSeason ? 'recruiting_season' : null,
        interested ? 'student_or_application_signal' : null,
      ].filter(Boolean)),
    });
  }

  if (hiringAvailability === 'NO_OPENINGS') {
    return Object.freeze({
      queueLane: 'PORTAL_MONITOR',
      scheduleClass: 'LOW_FREQUENCY',
      intervalHours: 24 * 14,
      priority: 35,
      browserAllowed: false,
      reasons: Object.freeze(['confirmed_no_openings']),
    });
  }

  return Object.freeze({
    queueLane: 'PORTAL_MONITOR',
    scheduleClass: 'STANDARD',
    intervalHours: 24 * 7,
    priority: 60,
    browserAllowed: false,
    reasons: Object.freeze(['verified_endpoint_standard']),
  });
}
