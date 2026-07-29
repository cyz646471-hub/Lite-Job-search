import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCompanyRegistry,
  selectUnseenCompanies,
} from '../src/application/resolve-task-companies.mjs';

test('normalizes array, companies and rawCompanies registry shapes', () => {
  const arrayRows = normalizeCompanyRegistry([
    {
      name_cn: '示例科技',
      name_en: 'Example Tech',
      aliases: ['Example'],
      official_domains: ['example.com'],
      industry: ['AI'],
    },
  ], { market: 'CN', source: 'golden.json' });
  const companyRows = normalizeCompanyRegistry({
    companies: [{ company: '第二公司' }],
  }, { market: 'CN' });
  const rawRows = normalizeCompanyRegistry({
    rawCompanies: ['第三公司'],
  }, { market: 'CN' });

  assert.deepEqual(arrayRows[0], {
    company: '示例科技',
    chineseName: '示例科技',
    englishName: 'Example Tech',
    aliases: ['Example'],
    officialDomain: 'example.com',
    industry: ['AI'],
    countryRegion: null,
    market: 'CN',
    registrySource: 'golden.json',
  });
  assert.equal(companyRows[0].company, '第二公司');
  assert.equal(rawRows[0].company, '第三公司');
});

test('excludes SQLite companies by formal name, alias, bilingual name or official domain', () => {
  const registryCompanies = normalizeCompanyRegistry([
    { company: '字节跳动', aliases: ['ByteDance'], officialDomain: 'bytedance.com' },
    { company: '小红书', aliases: ['RED'] },
    { company: '示例科技', englishName: 'Example Tech' },
    { company: '保留公司', officialDomain: 'keep.example' },
  ], { market: 'CN' });
  const knownCompanies = [
    {
      canonicalName: 'ByteDance Ltd',
      chineseName: null,
      englishName: null,
      aliases: ['字节跳动'],
      officialDomains: [],
      market: 'CN',
    },
    {
      canonicalName: 'RED',
      aliases: [],
      officialDomains: [],
      market: 'CN',
    },
    {
      canonicalName: 'Other Example',
      englishName: 'Example Tech',
      aliases: [],
      officialDomains: [],
      market: 'CN',
    },
  ];

  const result = selectUnseenCompanies({
    registryCompanies,
    knownCompanies,
    targetCount: 10,
    market: 'CN',
  });

  assert.deepEqual(result.companies.map((item) => item.company), ['保留公司']);
  assert.equal(result.stats.excludedKnown, 3);
  assert.equal(result.stats.selected, 1);
  assert.equal(result.stats.shortage, 9);
  assert.equal(result.supplementStatus, 'NOT_CONFIGURED');
});

test('deduplicates local rows before appending configured supplement rows', () => {
  const result = selectUnseenCompanies({
    registryCompanies: normalizeCompanyRegistry([
      { company: '甲公司', aliases: ['Company A'] },
      { company: 'Company A' },
      { company: '乙公司' },
    ], { market: 'CN' }),
    knownCompanies: [],
    supplementCompanies: normalizeCompanyRegistry([
      { company: '乙公司' },
      { company: '丙公司' },
    ], { market: 'CN', source: 'supplement' }),
    supplementConfigured: true,
    targetCount: 3,
    market: 'CN',
  });

  assert.deepEqual(result.companies.map((item) => item.company), [
    '甲公司',
    '乙公司',
    '丙公司',
  ]);
  assert.equal(result.stats.duplicateCandidates, 2);
  assert.equal(result.stats.shortage, 0);
  assert.equal(result.supplementStatus, 'USED');
});

test('does not deduplicate companies across markets', () => {
  const result = selectUnseenCompanies({
    registryCompanies: normalizeCompanyRegistry([
      { company: 'Example Tech' },
    ], { market: 'NA' }),
    knownCompanies: [{
      canonicalName: 'Example Tech',
      aliases: [],
      officialDomains: [],
      market: 'CN',
    }],
    targetCount: 1,
    market: 'NA',
  });

  assert.equal(result.companies.length, 1);
  assert.equal(result.stats.excludedKnown, 0);
});

test('reports exclusions and duplicates across the full registry after the target is filled', () => {
  const result = selectUnseenCompanies({
    registryCompanies: normalizeCompanyRegistry([
      { company: '首选公司' },
      { company: '已知公司' },
      { company: '首选公司' },
    ], { market: 'CN' }),
    knownCompanies: [{
      canonicalName: '已知公司',
      aliases: [],
      officialDomains: [],
      market: 'CN',
    }],
    targetCount: 1,
    market: 'CN',
  });

  assert.deepEqual(result.companies.map((item) => item.company), ['首选公司']);
  assert.equal(result.stats.excludedKnown, 1);
  assert.equal(result.stats.duplicateCandidates, 1);
});
