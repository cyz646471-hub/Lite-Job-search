import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';
import { resolveOccupationTaxonomy } from '../taxonomy/occupation-taxonomy.mjs';

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
  runId = null,
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
    context: { runId },
  }));
  const taxonomy = resolveOccupationTaxonomy(intent);
  const primaryRole = clean(raw.primaryRole || intent.roleType);
  const terms = list([
    ...(raw.terms || []),
    ...taxonomy.chineseTerms,
    ...taxonomy.industryTerms,
  ]);
  return Object.freeze({
    primaryRole,
    roleFamily: clean(raw.roleFamily) || taxonomy.roleFamily,
    terms: terms.length ? terms : Object.freeze([primaryRole]),
    englishTerms: list([...(raw.englishTerms || []), ...taxonomy.englishTerms]),
    synonyms: list([...(raw.synonyms || []), ...taxonomy.synonyms]),
    exclusions: list([...(raw.exclusions || []), ...taxonomy.exclusions], 20),
    taxonomyVersion: taxonomy.version,
    promptVersion: clean(raw.promptVersion) || 'keyword-expansion-v1',
  });
}
