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
  const scores = (
    observations.officialConfidenceScores
    || observations.confidenceScores
    || []
  )
    .map(Number)
    .filter(Number.isFinite);
  const officialJobExtractionSuccessRate = ratio(
    observations.officialExtractionSuccesses ?? observations.extractionSuccesses,
    observations.officialExtractionAttempts ?? observations.extractionAttempts,
  );
  const averageOfficialConfidenceScore = Object.freeze({
    sampleSize: scores.length,
    value: scores.length
      ? Number((scores.reduce((sum, value) => sum + value, 0) / scores.length).toFixed(2))
      : null,
  });
  return Object.freeze({
    officialVerificationRate: ratio(
      observations.portalsVerified,
      observations.portalsEvaluated,
    ),
    officialJobExtractionSuccessRate,
    jobExtractionSuccessRate: officialJobExtractionSuccessRate,
    platformOnlyAcceptanceCount: count(observations.platformOnlyAcceptanceCount),
    platformOnlySupersededRate: ratio(
      observations.platformOnlySupersededCount,
      observations.platformOnlyAcceptanceCount,
    ),
    duplicateRate: ratio(
      observations.duplicateCandidateResults,
      observations.validCandidateResults,
    ),
    falsePositiveRate: ratio(
      observations.falsePositiveCount,
      observations.groundTruthEvaluated,
    ),
    averageOfficialConfidenceScore,
    averageConfidenceScore: averageOfficialConfidenceScore,
    unknownAvailabilityRate: ratio(
      observations.unknownAvailabilityCount,
      observations.availabilityEvaluated,
    ),
    blockedRate: ratio(
      observations.blockedPortals,
      observations.portalsEvaluated,
    ),
    missingStartDateRate: ratio(
      observations.missingStartDates,
      observations.recruitmentEventsEvaluated,
    ),
    missingCloseDateRate: ratio(
      observations.missingCloseDates,
      observations.recruitmentEventsEvaluated,
    ),
    missingLocationRate: ratio(
      observations.missingLocations,
      observations.recruitmentEventsEvaluated,
    ),
  });
}
