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
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  });
}
