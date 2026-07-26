export const EVIDENCE_RULES = Object.freeze({
  official_domain_match: Object.freeze({
    direction: 'POSITIVE',
    weight: 35,
    identityAnchor: true,
  }),
  verified_ats_tenant: Object.freeze({
    direction: 'POSITIVE',
    weight: 20,
    identityAnchor: true,
  }),
  official_site_confirms_ats_tenant: Object.freeze({
    direction: 'POSITIVE',
    weight: 45,
    identityAnchor: true,
  }),
  recruitment_structure: Object.freeze({
    direction: 'POSITIVE',
    weight: 15,
    identityAnchor: false,
  }),
  apply_action: Object.freeze({
    direction: 'POSITIVE',
    weight: 15,
    identityAnchor: false,
  }),
  official_site_backlink: Object.freeze({
    direction: 'POSITIVE',
    weight: 15,
    identityAnchor: true,
  }),
  legal_entity_match: Object.freeze({
    direction: 'POSITIVE',
    weight: 35,
    identityAnchor: true,
  }),
  official_announcement_lists_url: Object.freeze({
    direction: 'POSITIVE',
    weight: 35,
    identityAnchor: true,
  }),
  ats_fingerprint_only: Object.freeze({
    direction: 'NEUTRAL',
    weight: 0,
    identityAnchor: false,
  }),
  candidate_self_domain: Object.freeze({
    direction: 'NEUTRAL',
    weight: 0,
    identityAnchor: false,
  }),
  llm_advisory: Object.freeze({
    direction: 'NEUTRAL',
    weight: 0,
    identityAnchor: false,
  }),
  blocked_page: Object.freeze({
    direction: 'NEUTRAL',
    weight: 0,
    identityAnchor: false,
  }),
  aggregator_domain: Object.freeze({
    direction: 'NEGATIVE',
    weight: -70,
    identityAnchor: false,
    hardReject: true,
  }),
  university_employment_site: Object.freeze({
    direction: 'NEGATIVE',
    weight: -60,
    identityAnchor: false,
    hardReject: true,
  }),
  news_reprint: Object.freeze({
    direction: 'NEGATIVE',
    weight: -50,
    identityAnchor: false,
    hardReject: true,
  }),
  training_provider: Object.freeze({
    direction: 'NEGATIVE',
    weight: -60,
    identityAnchor: false,
    hardReject: true,
  }),
  company_identity_conflict: Object.freeze({
    direction: 'NEGATIVE',
    weight: -80,
    identityAnchor: false,
    hardReject: true,
  }),
  private_or_payment_risk: Object.freeze({
    direction: 'NEGATIVE',
    weight: -100,
    identityAnchor: false,
    hardReject: true,
  }),
});
