function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function ratio(numerator, denominator) {
  const safeNumerator = count(numerator);
  const safeDenominator = count(denominator);
  return Object.freeze({
    numerator: safeNumerator,
    denominator: safeDenominator,
    value: safeDenominator === 0
      ? null
      : Number((safeNumerator / safeDenominator).toFixed(4)),
  });
}
export function buildQualityReport(observations = {}) {
  const scores = (observations.confidenceScores || [])
    .map(Number)
    .filter(Number.isFinite);
  return Object.freeze({
    officialVerificationRate: ratio(
      observations.portalsVerified,
      observations.portalsEvaluated,
    ),
    jobExtractionSuccessRate: ratio(
      observations.extractionSuccesses,
      observations.extractionAttempts,
    ),
    duplicateRate: ratio(
      observations.duplicateCandidateResults,
      observations.validCandidateResults,
    ),
    falsePositiveRate: ratio(
      observations.rejectedPortals,
      observations.portalsEvaluated,
    ),
    averageConfidenceScore: Object.freeze({
      sampleSize: scores.length,
      value: scores.length
        ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
        : null,
    }),
  });
}
