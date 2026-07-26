import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyCareerPortal } from '../src/verification/verification-engine.mjs';

test('portal without independent identity anchor is not verified', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'ats_fingerprint_only' },
      { code: 'recruitment_structure' },
      { code: 'apply_action' },
    ],
  });

  assert.equal(result.verificationStatus, 'REJECTED');
  assert.equal(result.identityAnchor, false);
  assert.equal(result.confidenceScore, 30);
});

test('candidate URL cannot use its own registrable domain as official proof', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'candidate_self_domain' },
      { code: 'recruitment_structure' },
    ],
  });

  assert.notEqual(result.verificationStatus, 'VERIFIED');
  assert.equal(result.identityAnchor, false);
});

test('hard rejected aggregator wins before ATS tenant evidence', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'aggregator_domain' },
      { code: 'verified_ats_tenant' },
      { code: 'recruitment_structure' },
      { code: 'apply_action' },
    ],
  });

  assert.equal(result.verificationStatus, 'REJECTED');
  assert.deepEqual(result.hardRejectReasons, ['aggregator_domain']);
});

test('independent official domain and backlink verify a recruitment page', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    atsType: 'MOKA',
    evidence: [
      { code: 'official_domain_match' },
      { code: 'recruitment_structure' },
      { code: 'apply_action' },
      { code: 'official_site_backlink' },
    ],
  });

  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.confidenceScore, 80);
  assert.equal(result.identityAnchor, true);
  assert.equal(result.atsType, 'MOKA');
});

test('official domain and recruitment structure verify at the 50-point threshold', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      { code: 'official_domain_match' },
      { code: 'recruitment_structure' },
    ],
  });

  assert.equal(result.confidenceScore, 50);
  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.identityAnchor, true);
});

test('official-site-confirmed ATS tenant is an independent identity anchor', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    atsType: 'MOKA',
    evidence: [
      { code: 'official_site_confirms_ats_tenant' },
      { code: 'verified_ats_tenant' },
      { code: 'recruitment_structure' },
    ],
  });

  assert.equal(result.verificationStatus, 'VERIFIED');
  assert.equal(result.identityAnchor, true);
  assert.equal(result.confidenceScore, 80);
});

test('LLM advisory has no scoring or identity authority', () => {
  const result = verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [
      {
        code: 'llm_advisory',
        weight: 99,
        direction: 'POSITIVE',
        identityAnchor: true,
      },
      { code: 'recruitment_structure' },
    ],
  });

  assert.equal(result.confidenceScore, 15);
  assert.equal(result.identityAnchor, false);
  assert.equal(result.verificationStatus, 'REJECTED');
});

test('blocked page is held for review without bypassing access control', () => {
  const result = verifyCareerPortal({
    pageType: 'UNKNOWN',
    evidence: [
      { code: 'official_domain_match' },
      { code: 'blocked_page' },
    ],
  });

  assert.equal(result.verificationStatus, 'BLOCKED');
  assert.equal(result.identityAnchor, true);
});

test('unknown evidence code is rejected instead of silently scored', () => {
  assert.throws(() => verifyCareerPortal({
    pageType: 'JOB_LIST',
    evidence: [{ code: 'invented_signal' }],
  }), /unknown verification evidence/);
});
