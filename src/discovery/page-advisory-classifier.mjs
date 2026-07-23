import { createVerificationEvidence } from '../domain/verification-evidence.mjs';
import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

const LABELS = new Set([
  'LIKELY_CAREER',
  'LIKELY_AGGREGATOR',
  'LIKELY_NEWS',
  'UNKNOWN',
]);

export async function classifyPageAdvisory(page, {
  planningModel,
  observedAt = new Date().toISOString(),
} = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'classify_page',
    input: {
      url: String(page.url || ''),
      title: String(page.title || '').slice(0, 300),
      text: String(page.text || '').slice(0, 2_000),
    },
  }));
  const label = LABELS.has(raw.label) ? raw.label : 'UNKNOWN';
  return createVerificationEvidence({
    code: 'llm_advisory',
    direction: 'NEUTRAL',
    weight: 0,
    observedValue: JSON.stringify({
      label,
      confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
      rationale: String(raw.rationale || '').slice(0, 500),
    }),
    sourceUrl: page.url || null,
  }, { observedAt });
}
