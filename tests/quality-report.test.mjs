import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQualityReport } from '../src/quality/quality-report.mjs';

test('quality report exposes observed numerators, denominators and confidence', () => {
  const report = buildQualityReport({
    portalsEvaluated: 5,
    portalsVerified: 3,
    extractionAttempts: 3,
    extractionSuccesses: 2,
    validCandidateResults: 10,
    duplicateCandidateResults: 2,
    rejectedPortals: 1,
    falsePositiveCount: 1,
    groundTruthEvaluated: 5,
    confidenceScores: [90, 80, 70],
    platformOnlyAcceptanceCount: 2,
    platformOnlySupersededCount: 1,
    availabilityEvaluated: 5,
    unknownAvailabilityCount: 1,
    blockedPortals: 1,
    recruitmentEventsEvaluated: 4,
    missingStartDates: 1,
    missingCloseDates: 2,
    missingLocations: 1,
  });

  assert.deepEqual(report.officialVerificationRate, {
    numerator: 3,
    denominator: 5,
    value: 0.6,
  });
  assert.deepEqual(report.officialJobExtractionSuccessRate, {
    numerator: 2,
    denominator: 3,
    value: 0.6667,
  });
  assert.equal(report.duplicateRate.value, 0.2);
  assert.equal(report.falsePositiveRate.value, 0.2);
  assert.deepEqual(report.averageOfficialConfidenceScore, {
    sampleSize: 3,
    value: 80,
  });
  assert.equal(report.platformOnlyAcceptanceCount, 2);
  assert.equal(report.platformOnlySupersededRate.value, 0.5);
  assert.equal(report.unknownAvailabilityRate.value, 0.2);
  assert.equal(report.blockedRate.value, 0.2);
  assert.equal(report.missingStartDateRate.value, 0.25);
  assert.equal(report.missingCloseDateRate.value, 0.5);
  assert.equal(report.missingLocationRate.value, 0.25);
});

test('quality report uses null when a metric has no observed denominator', () => {
  const report = buildQualityReport({});
  assert.equal(report.officialVerificationRate.value, null);
  assert.equal(report.officialJobExtractionSuccessRate.value, null);
  assert.equal(report.duplicateRate.value, null);
  assert.equal(report.falsePositiveRate.value, null);
  assert.equal(report.averageOfficialConfidenceScore.value, null);
  assert.equal(report.platformOnlyAcceptanceCount, 0);
});

test('does not label deterministic rejection rate as false positives without ground truth', () => {
  const report = buildQualityReport({
    portalsEvaluated: 5,
    rejectedPortals: 2,
  });

  assert.deepEqual(report.falsePositiveRate, {
    numerator: 0,
    denominator: 0,
    value: null,
  });
});
