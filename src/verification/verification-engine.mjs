import { applyVerificationPolicy } from './verification-policy.mjs';

export function verifyCareerPortal(input = {}) {
  return Object.freeze({
    pageType: input.pageType || 'UNKNOWN',
    atsType: input.atsType || '',
    ...applyVerificationPolicy({
      pageType: input.pageType,
      evidence: input.evidence,
    }),
  });
}
