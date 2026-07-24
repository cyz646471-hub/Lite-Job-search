const FORBIDDEN_FIELDS = new Set([
  'isOfficial',
  'officialIdentityConfirmed',
  'officialDomainConfirmed',
  'verificationStatus',
  'confidenceScore',
  'identityAnchor',
  'hardReject',
  'weight',
  'direction',
]);

function scanForForbiddenFields(value) {
  if (Array.isArray(value)) {
    value.forEach(scanForForbiddenFields);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.has(key)) throw new Error(`forbidden LLM field: ${key}`);
    scanForForbiddenFields(child);
  }
}

export function assertPlanningModel(model) {
  if (!model || typeof model.generate !== 'function') {
    throw new Error('planningModel.generate is required');
  }
  if (model.configured === false) throw new Error('planning model is not configured');
  return model;
}

export function validatePlanningOutput(value) {
  scanForForbiddenFields(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('planning output must be an object');
  }
  return value;
}
