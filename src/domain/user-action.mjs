import { randomUUID } from 'node:crypto';

export const USER_ACTION_TYPES = Object.freeze([
  'VIEWED',
  'SAVED',
  'DISMISSED',
  'APPLY_STARTED',
  'APPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'REPORT_INVALID',
]);

export function createUserAction(input = {}, { now = new Date().toISOString() } = {}) {
  if (!input.actorId) throw new Error('UserAction actorId is required');
  if (!USER_ACTION_TYPES.includes(input.actionType)) throw new Error('unsupported UserAction actionType');
  return Object.freeze({
    id: String(input.id || randomUUID()),
    actorId: String(input.actorId),
    studentId: input.studentId ? String(input.studentId) : null,
    jobId: input.jobId ? String(input.jobId) : null,
    actionType: input.actionType,
    note: input.note || null,
    triggersReverification: input.triggersReverification === true
      || input.actionType === 'REPORT_INVALID',
    createdAt: input.createdAt || now,
  });
}
