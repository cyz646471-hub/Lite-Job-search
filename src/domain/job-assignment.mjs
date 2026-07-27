import { randomUUID } from 'node:crypto';

export const ASSIGNEE_TYPES = Object.freeze(['STUDENT', 'PLANNER', 'TEAM']);
export const ASSIGNMENT_STATUSES = Object.freeze(['ASSIGNED', 'ACCEPTED', 'COMPLETED', 'CANCELLED']);

export function createJobAssignment(input = {}, { now = new Date().toISOString() } = {}) {
  if (!input.jobId || !input.assigneeId || !input.assignedBy) {
    throw new Error('JobAssignment jobId, assigneeId and assignedBy are required');
  }
  const assigneeType = input.assigneeType || 'STUDENT';
  const status = input.status || 'ASSIGNED';
  if (!ASSIGNEE_TYPES.includes(assigneeType)) throw new Error('unsupported JobAssignment assigneeType');
  if (!ASSIGNMENT_STATUSES.includes(status)) throw new Error('unsupported JobAssignment status');
  return Object.freeze({
    id: String(input.id || randomUUID()),
    jobId: String(input.jobId),
    assigneeType,
    assigneeId: String(input.assigneeId),
    assignedBy: String(input.assignedBy),
    status,
    note: input.note || null,
    assignedAt: input.assignedAt || now,
    updatedAt: input.updatedAt || now,
  });
}
