import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCnMarketDiscoveryPlan, extractCnMarketCompanyLeads } from '../src/application/build-cn-market-discovery-plan.mjs';

test('CN market plan prioritizes private cohorts and has deterministic no-LLM policy', () => {
  const plan = buildCnMarketDiscoveryPlan({ role: '产品经理', industry: 'AI', targetCount: 10 });
  assert.equal(plan.mode, 'CN_MARKET_COMPANY_DISCOVERY');
  assert.equal(plan.queries[0].priorityTier, 1);
  assert.equal(plan.queries.at(-1).priorityTier, 3);
  assert.equal(plan.llmUsage.enabled, false);
  assert.equal(plan.queryPolicy.searchEngine, 'google');
  assert.match(plan.queries[0].query, /中国/);
});

test('CN market lead extraction rejects aggregators and duplicates before queueing', () => {
  const result = extractCnMarketCompanyLeads([
    { title: '未来智造 2026校园招聘 - 招聘官网', href: 'https://jobs.future.example/campus', snippet: '校园招聘 岗位', kind: 'organic' },
    { title: '智创科技 招聘官网', href: 'https://www.jobui.com/company/1/jobs', snippet: '招聘', kind: 'organic' },
    { title: '未来智造 社会招聘', href: 'https://jobs.future.example/social', snippet: '社会招聘', kind: 'organic' },
    { title: '某大学就业网 招聘', href: 'https://job.university.example/1', snippet: '校园招聘', kind: 'organic' },
  ], { query: { query: 'AI 产品经理 招聘官网', cohort: 'AI与大模型', priorityTier: 1 } });
  assert.equal(result.leads.length, 2);
  assert.equal(result.leads[0].company, '未来智造');
  assert.equal(result.leads[0].priorityTier, 1);
  assert.equal(result.leads[1].discoveryEvidenceClass, 'THIRD_PARTY_COMPANY_LEAD');
  assert.equal(result.leads[1].recruitmentEntryEligible, false);
  assert.equal(result.rejected.length, 2);
});
