import assert from 'node:assert/strict';
import test from 'node:test';

import { expandKeywords } from '../src/discovery/keyword-expander.mjs';
import { classifyPageAdvisory } from '../src/discovery/page-advisory-classifier.mjs';
import { planQueries } from '../src/discovery/query-planner.mjs';

function fakePlanningModel(outputs) {
  return {
    configured: true,
    async generate({ task }) {
      return structuredClone(outputs[task]);
    },
  };
}

const intent = {
  market: 'CN',
  roleType: 'AI 产品经理',
  industryTags: ['AI', '互联网'],
  freshnessDays: 90,
  targetCount: 20,
  locale: 'zh-CN',
};

test('keyword expansion returns controlled multilingual terms', async () => {
  const model = fakePlanningModel({
    expand_keywords: {
      primaryRole: 'AI 产品经理',
      roleFamily: 'PRODUCT_MANAGEMENT',
      terms: ['AI 产品经理', '大模型产品经理', 'AI 产品经理'],
      englishTerms: ['AI Product Manager'],
      synonyms: ['人工智能产品经理'],
      exclusions: ['培训'],
    },
  });

  const result = await expandKeywords(intent, { planningModel: model });

  assert.deepEqual(result.terms, ['AI 产品经理', '大模型产品经理']);
  assert.deepEqual(result.englishTerms, ['AI Product Manager']);
  assert.equal(result.roleFamily, 'PRODUCT_MANAGEMENT');
});

test('planning firewall rejects attempts to decide official truth', async () => {
  const model = fakePlanningModel({
    expand_keywords: {
      primaryRole: 'AI 产品经理',
      terms: ['AI 产品经理'],
      nested: { isOfficial: true },
    },
  });

  await assert.rejects(
    expandKeywords(intent, { planningModel: model }),
    /forbidden LLM field: isOfficial/,
  );
});

test('planning firewall rejects scoring and identity controls', async () => {
  for (const forbidden of ['verificationStatus', 'confidenceScore', 'identityAnchor', 'weight', 'direction']) {
    const model = fakePlanningModel({
      expand_keywords: {
        primaryRole: 'AI 产品经理',
        terms: ['AI 产品经理'],
        [forbidden]: forbidden === 'weight' ? 100 : true,
      },
    });
    await assert.rejects(
      expandKeywords(intent, { planningModel: model }),
      new RegExp(`forbidden LLM field: ${forbidden}`),
    );
  }
});

test('query planner enforces provider, freshness, count and topK limits', async () => {
  const model = fakePlanningModel({
    plan_queries: {
      queries: [
        {
          text: `  "AI 产品经理" 招聘 ${'x'.repeat(300)} `,
          preferredSources: ['baidu', 'unknown-provider', 'baidu'],
          freshnessDays: 999,
          topK: 999,
        },
        {
          text: '"AI 产品经理" 招聘',
          preferredSources: ['manual'],
          topK: 5,
        },
      ],
    },
  });

  const result = await planQueries(intent, { terms: ['AI 产品经理'] }, {
    planningModel: model,
    providerAllowlist: ['baidu', 'tavily', 'brave', 'manual'],
    maxQueries: 1,
  });

  assert.equal(result.queries.length, 1);
  assert.equal(result.queries[0].text.length, 240);
  assert.deepEqual(result.queries[0].preferredSources, ['baidu']);
  assert.equal(result.queries[0].freshnessDays, 90);
  assert.equal(result.queries[0].topK, 20);
});

test('query planner rejects an empty usable plan', async () => {
  const model = fakePlanningModel({ plan_queries: { queries: [{ text: '   ' }] } });
  await assert.rejects(
    planQueries(intent, { terms: [] }, { planningModel: model }),
    /no usable queries/,
  );
});

test('low-confidence page classification creates neutral advisory evidence', async () => {
  const model = fakePlanningModel({
    classify_page: {
      label: 'LIKELY_CAREER',
      confidence: 0.72,
      rationale: '页面包含职位列表语义',
    },
  });

  const advisory = await classifyPageAdvisory({
    url: 'https://tenant.example/jobs',
    title: '招聘职位',
    text: '产品经理 上海',
  }, {
    planningModel: model,
    observedAt: '2026-07-24T00:00:00.000Z',
  });

  assert.equal(advisory.code, 'llm_advisory');
  assert.equal(advisory.direction, 'NEUTRAL');
  assert.equal(advisory.weight, 0);
  assert.equal(JSON.parse(advisory.observedValue).label, 'LIKELY_CAREER');
});
