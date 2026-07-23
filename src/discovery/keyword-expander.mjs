import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function list(value, limit = 20) {
  return Object.freeze(
    [...new Set((Array.isArray(value) ? value : [])
      .map(clean)
      .filter(Boolean))]
      .slice(0, limit),
  );
}

export async function expandKeywords(intent, {
  planningModel,
} = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'expand_keywords',
    input: {
      roleType: intent.roleType,
      industryTags: intent.industryTags || [],
      market: intent.market,
      locale: intent.locale,
    },
  }));
  const primaryRole = clean(raw.primaryRole || intent.roleType);
  const terms = list(raw.terms);
  return Object.freeze({
    primaryRole,
    roleFamily: clean(raw.roleFamily) || 'OTHER',
    terms: terms.length ? terms : Object.freeze([primaryRole]),
    englishTerms: list(raw.englishTerms),
    synonyms: list(raw.synonyms),
    exclusions: list(raw.exclusions, 10),
    promptVersion: clean(raw.promptVersion) || 'keyword-expansion-v1',
  });
}
