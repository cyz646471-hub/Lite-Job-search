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
    confidenceScores: [90, 80, 70, 50, 0],
  });

  assert.deepEqual(report.officialVerificationRate, {
    numerator: 3,
    denominator: 5,
    value: 0.6,
  });
  assert.deepEqual(report.jobExtractionSuccessRate, {
    numerator: 2,
    denominator: 3,
    value: 0.6667,
  });
  assert.equal(report.duplicateRate.value, 0.2);
  assert.equal(report.falsePositiveRate.value, 0.2);
  assert.deepEqual(report.averageConfidenceScore, {
    sampleSize: 5,
    value: 58,
  });
});

test('quality report uses null when a metric has no observed denominator', () => {
  const report = buildQualityReport({});
  assert.equal(report.officialVerificationRate.value, null);
  assert.equal(report.jobExtractionSuccessRate.value, null);
  assert.equal(report.duplicateRate.value, null);
  assert.equal(report.falsePositiveRate.value, null);
  assert.equal(report.averageConfidenceScore.value, null);
});
