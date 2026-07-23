import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveOccupationTaxonomy } from '../src/taxonomy/occupation-taxonomy.mjs';

test('taxonomy expands product, engineering, marketing, AI and 3C vocabulary', () => {
  const aiProduct = resolveOccupationTaxonomy({
    roleType: 'AI产品经理',
    industryTags: ['AI'],
  });
  assert.equal(aiProduct.roleFamily, 'PRODUCT');
  assert.ok(aiProduct.chineseTerms.includes('AI产品经理'));
  assert.ok(aiProduct.englishTerms.includes('AI Product Manager'));
  assert.ok(aiProduct.chineseTerms.includes('数据产品经理'));
  assert.ok(aiProduct.exclusions.includes('课程培训'));

  const backend = resolveOccupationTaxonomy({
    roleType: '后端开发',
    industryTags: [],
  });
  assert.equal(backend.roleFamily, 'ENGINEERING');
  assert.ok(backend.englishTerms.includes('Backend Engineer'));

  const overseasMarketing = resolveOccupationTaxonomy({
    roleType: '海外市场营销',
    industryTags: ['3C'],
  });
  assert.equal(overseasMarketing.roleFamily, 'MARKETING');
  assert.ok(overseasMarketing.englishTerms.includes('International Marketing'));
  assert.ok(overseasMarketing.industryTerms.includes('consumer electronics'));
});
