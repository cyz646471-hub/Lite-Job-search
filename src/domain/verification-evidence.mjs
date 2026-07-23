export const EVIDENCE_DIRECTIONS = Object.freeze(['POSITIVE', 'NEGATIVE', 'NEUTRAL']);

export function createVerificationEvidence(input = {}, {
  observedAt = new Date().toISOString(),
} = {}) {
  if (!input.code || !EVIDENCE_DIRECTIONS.includes(input.direction)) {
    throw new Error('VerificationEvidence code and direction are required');
  }
  return Object.freeze({
    code: String(input.code),
    direction: input.direction,
    weight: Number(input.weight) || 0,
    observedValue: input.observedValue == null ? null : String(input.observedValue),
    sourceUrl: input.sourceUrl || null,
    observedAt: input.observedAt || observedAt,
  });
}
