import { assertPlanningModel, validatePlanningOutput } from '../ports/llm-planner.mjs';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export async function planQueries(intent, keywords, {
  planningModel,
  providerAllowlist = ['baidu', 'tavily', 'brave', 'manual'],
  maxQueries = 12,
  runId = null,
} = {}) {
  const model = assertPlanningModel(planningModel);
  const raw = validatePlanningOutput(await model.generate({
    task: 'plan_queries',
    input: { intent, keywords },
    context: { runId },
  }));
  const allowedProviders = new Set(providerAllowlist);
  const seen = new Set();
  const queries = [];
  const boundedMaxQueries = Math.min(20, Math.max(1, Number(maxQueries) || 12));
  for (const item of Array.isArray(raw.queries) ? raw.queries : []) {
    const text = clean(item?.text).slice(0, 240);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    queries.push(Object.freeze({
      text,
      purpose: clean(item.purpose) || 'role_recall',
      preferredSources: Object.freeze([
        ...new Set((item.preferredSources || []).filter((name) => allowedProviders.has(name))),
      ]),
      freshnessDays: intent.freshnessDays,
      topK: Math.min(20, Math.max(1, Number(item.topK) || 8)),
    }));
    if (queries.length >= boundedMaxQueries) break;
  }
  if (!queries.length) throw new Error('planning output contains no usable queries');
  return Object.freeze({
    market: intent.market,
    queries: Object.freeze(queries),
    promptVersion: clean(raw.promptVersion) || 'query-planning-v1',
  });
}
