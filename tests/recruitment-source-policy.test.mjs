import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyRecruitmentSource,
  decidePlatformFallback,
} from '../src/verification/recruitment-source-policy.mjs';

test('hard excluded domains never become formal recruitment sources', () => {
  for (const url of [
    'https://www.jobui.com/company/1/',
    'https://jobs.51job.com/company/1/',
    'https://www.nowcoder.com/jobs/1',
    'https://career.example.edu.cn/news/1',
  ]) {
    assert.equal(
      classifyRecruitmentSource({ url }).decision,
      'DISCOVERY_LOG_ONLY',
      url,
    );
  }
});

test('ads, news and search-engine pages remain discovery-log-only', () => {
  assert.equal(classifyRecruitmentSource({
    url: 'https://jobs.example.com/',
    kind: 'advertisement',
  }).decision, 'DISCOVERY_LOG_ONLY');
  assert.equal(classifyRecruitmentSource({
    url: 'https://example.com/news/company-hiring',
    title: '公司招聘新闻转载',
  }).decision, 'DISCOVERY_LOG_ONLY');
  assert.equal(classifyRecruitmentSource({
    url: 'https://www.baidu.com/s?wd=company+jobs',
  }).decision, 'DISCOVERY_LOG_ONLY');
});

test('Liepin and BOSS exact company pages are platform-only candidates', () => {
  const liepin = classifyRecruitmentSource({
    url: 'https://www.liepin.com/company-jobs/13296749/',
    title: '希奥端招聘',
    company: '希奥端',
  });
  const boss = classifyRecruitmentSource({
    url: 'https://www.zhipin.com/gongsir/abc123.html',
    title: '希奥端招聘职位',
    company: '希奥端',
  });

  assert.deepEqual([liepin.decision, boss.decision], [
    'PLATFORM_CANDIDATE',
    'PLATFORM_CANDIDATE',
  ]);
  assert.equal(liepin.sourceTier, 'PLATFORM_ONLY');
  assert.equal(liepin.platform, 'LIEPIN');
  assert.equal(boss.platform, 'BOSS');
});

test('platform job details and identity mismatches are not platform company candidates', () => {
  assert.equal(classifyRecruitmentSource({
    url: 'https://www.liepin.com/job/123/',
    title: '希奥端产品经理',
    company: '希奥端',
  }).decision, 'DISCOVERY_LOG_ONLY');
  assert.equal(classifyRecruitmentSource({
    url: 'https://www.liepin.com/company-jobs/13296749/',
    title: '南京希奥端分公司招聘',
    company: '希奥端',
  }).decision, 'DISCOVERY_LOG_ONLY');
});

test('WeChat recruitment articles are isolated as official-social verification candidates', () => {
  const result = classifyRecruitmentSource({
    url: 'https://mp.weixin.qq.com/s/example-article',
    title: '示例科技 2027 届校园招聘',
    company: '示例科技',
  });

  assert.equal(result.decision, 'VERIFY_OFFICIAL_SOCIAL_CANDIDATE');
  assert.equal(result.sourceTier, 'OFFICIAL_SOCIAL');
  assert.equal(result.channelType, 'WECHAT_OFFICIAL_ACCOUNT');
});

test('platform source is hidden when an active official event exists', () => {
  const decision = decidePlatformFallback({
    officialPortals: [{
      verificationStatus: 'VERIFIED',
      hiringAvailability: 'OPENINGS_FOUND',
    }],
    platformCandidate: {
      platformIdentityConfirmed: true,
      jobs: [{ title: '产品经理' }],
    },
    searchCoverage: 'COMPLETE',
  });

  assert.deepEqual(decision, {
    publish: false,
    reasonCode: 'OFFICIAL_SOURCE_AVAILABLE',
  });
});

test('eligible platform fallback records why no official source was usable', () => {
  const blocked = decidePlatformFallback({
    officialPortals: [{
      verificationStatus: 'BLOCKED',
      hiringAvailability: 'UNKNOWN',
    }],
    platformCandidate: {
      platformIdentityConfirmed: true,
      jobs: [{ title: '产品经理' }],
    },
    searchCoverage: 'COMPLETE',
  });
  const noOpenings = decidePlatformFallback({
    officialPortals: [{
      verificationStatus: 'VERIFIED',
      hiringAvailability: 'NO_OPENINGS',
    }],
    platformCandidate: {
      platformIdentityConfirmed: true,
      jobs: [{ title: '产品经理' }],
    },
  });

  assert.equal(blocked.publish, true);
  assert.equal(blocked.fallbackReason, 'OFFICIAL_INACCESSIBLE');
  assert.equal(noOpenings.fallbackReason, 'OFFICIAL_NO_OPENINGS');
});
