import { randomUUID } from 'node:crypto';

export const REVIEW_TYPES = Object.freeze([
  'PORTAL_VERIFICATION',
  'JOB_PUBLICATION',
  'DATA_COMPLETENESS',
]);
export const REVIEW_TARGET_TYPES = Object.freeze([
  'COMPANY',
  'CAREER_PORTAL',
  'RECRUITMENT_EVENT',
  'JOB_OPENING',
]);
export const REVIEW_STATUSES = Object.freeze(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']);

export function createReviewTask(input = {}, { now = new Date().toISOString() } = {}) {
  if (!REVIEW_TYPES.includes(input.reviewType)) throw new Error('unsupported ReviewTask reviewType');
  if (!REVIEW_TARGET_TYPES.includes(input.targetType)) throw new Error('unsupported ReviewTask targetType');
  if (!input.targetId) throw new Error('ReviewTask targetId is required');
  const status = input.status || 'OPEN';
  if (!REVIEW_STATUSES.includes(status)) throw new Error('unsupported ReviewTask status');
  return Object.freeze({
    id: String(input.id || randomUUID()),
    reviewType: input.reviewType,
    targetType: input.targetType,
    targetId: String(input.targetId),
    status,
    systemDecision: input.systemDecision || null,
    aiAdvice: input.aiAdvice || null,
    reviewer: input.reviewer || null,
    result: input.result || null,
    structuredChanges: Object.freeze({ ...(input.structuredChanges || {}) }),
    reasonCodes: Object.freeze([...(input.reasonCodes || [])]),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    reviewedAt: input.reviewedAt || null,
  });
}
