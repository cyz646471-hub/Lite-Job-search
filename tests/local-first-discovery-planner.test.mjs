import assert from 'node:assert/strict';
import test from 'node:test';

import { executeVerificationTask } from '../src/application/execute-verification-task.mjs';
import { discoverCompanyLocally } from '../src/application/discover-company-locally.mjs';
import {
  createSearchCacheKey,
  planCompanyDiscovery,
} from '../src/application/local-first-discovery-planner.mjs';
import {
  mergeLocalAndSearchDiscovery,
  shouldEscalateLocalDiscovery,
} from '../src/application/local-search-fallback.mjs';

function repository({
  portals = [],
  knowledge = [],
  cache = null,
} = {}) {
  return {
    listCareerPortals: () => portals,
    listCompanyWebKnowledge: () => knowledge,
    getReusableSearchCache: () => cache,
  };
}

const COMPANY = {
  id: 'company-1',
  canonicalName: '示例公司',
  officialDomains: [],
};

test('verified portal is reused without scheduling Baidu', () => {
  const plan = planCompanyDiscovery({
    company: COMPANY,
    roleKeywords: ['产品经理'],
    allowBaiduFallback: true,
  }, {
    repository: repository({
      portals: [{
        companyId: COMPANY.id,
        canonicalUrl: 'https://jobs.example.com/',
        verificationStatus: 'VERIFIED',
        sourceTier: 'OFFICIAL_SITE',
        officialIdentityConfirmed: true,
      }],
    }),
  });
  assert.equal(plan.queueType, 'LOCAL_OR_DIRECT_VERIFICATION');
  assert.equal(plan.terminalAction, 'VERIFY_CANDIDATES');
  assert.deepEqual(plan.candidates, ['https://jobs.example.com/']);
});

test('known official domain produces deterministic common paths before Baidu', () => {
  const plan = planCompanyDiscovery({
    company: { ...COMPANY, officialDomains: ['example.com'] },
    allowBaiduFallback: true,
  }, { repository: repository() });
  assert.equal(plan.queueType, 'LOCAL_OR_DIRECT_VERIFICATION');
  assert.ok(plan.candidates.includes('https://example.com/careers'));
  assert.equal(plan.searchFallbackAllowed, true);
});

test('reviewed career portal is planned before generic domain paths', () => {
  const reviewedUrl = 'https://www.hstong.com/hk/about/recruit';
  const plan = planCompanyDiscovery({
    company: {
      ...COMPANY,
      officialDomains: ['hstong.com'],
      reviewedCareerPortals: [reviewedUrl],
    },
    allowBaiduFallback: true,
  }, { repository: repository() });

  assert.equal(plan.candidates[0], reviewedUrl);
  assert.equal(
    plan.stages.find((stage) => stage.source === 'REVIEWED_CAREER_PORTAL').count,
    1,
  );
});

test('reviewed career portal overrides an older automated rejection', () => {
  const reviewedUrl = 'https://www.hstong.com/hk/about/recruit';
  const plan = planCompanyDiscovery({
    company: {
      ...COMPANY,
      officialDomains: ['hstong.com'],
      reviewedCareerPortals: [reviewedUrl],
    },
  }, {
    repository: repository({
      knowledge: [{
        companyId: COMPANY.id,
        knowledgeType: 'REJECTED_PORTAL',
        value: reviewedUrl,
        verificationStatus: 'REJECTED',
      }],
    }),
  });

  assert.equal(plan.candidates[0], reviewedUrl);
});

test('reviewed rejected domains override stale verified repository knowledge', () => {
  const plan = planCompanyDiscovery({
    company: {
      ...COMPANY,
      officialDomains: ['qifu.tech'],
      rejectedOfficialDomains: ['360shuoke.com'],
    },
    allowBaiduFallback: true,
  }, {
    repository: repository({
      portals: [{
        companyId: COMPANY.id,
        canonicalUrl: 'https://360shuoke.com/careers',
        verificationStatus: 'VERIFIED',
        sourceTier: 'OFFICIAL_SITE',
        officialIdentityConfirmed: true,
      }],
      knowledge: [{
        companyId: COMPANY.id,
        knowledgeType: 'OFFICIAL_DOMAIN',
        value: '360shuoke.com',
        verificationStatus: 'VERIFIED',
      }],
    }),
  });

  assert.deepEqual(plan.officialDomains, ['qifu.tech']);
  assert.equal(plan.candidates.some((url) => url.includes('360shuoke.com')), false);
});

test('fixed-pool planning checks only confirmed portals without domain expansion', () => {
  const plan = planCompanyDiscovery({
    company: { ...COMPANY, officialDomains: ['example.com'] },
    allowBaiduFallback: false,
    confirmedPortalsOnly: true,
  }, {
    repository: repository({
      portals: [{
        companyId: COMPANY.id,
        canonicalUrl: 'https://jobs.example.com/',
        verificationStatus: 'VERIFIED',
        sourceTier: 'OFFICIAL_SITE',
        officialIdentityConfirmed: true,
      }],
    }),
  });
  assert.deepEqual(plan.candidates, ['https://jobs.example.com/']);
  assert.deepEqual(plan.officialDomains, []);
  assert.equal(plan.confirmedPortalsOnly, true);
  assert.equal(plan.stages.find((stage) => stage.source === 'BAIDU_BROWSER').enabled, false);
});

test('no local evidence schedules Baidu only when explicitly allowed', () => {
  const baidu = planCompanyDiscovery({
    company: COMPANY,
    allowBaiduFallback: true,
  }, { repository: repository() });
  const manual = planCompanyDiscovery({
    company: COMPANY,
    allowBaiduFallback: false,
  }, { repository: repository() });
  assert.equal(baidu.queueType, 'BAIDU_DISCOVERY_REQUIRED');
  assert.equal(manual.terminalAction, 'MANUAL_OFFICIAL_DISCOVERY');
});

test('no local evidence can schedule Google with an engine-specific cache key', () => {
  const plan = planCompanyDiscovery({
    company: COMPANY,
    searchEngine: 'google',
    allowSearchFallback: true,
  }, { repository: repository() });
  assert.equal(plan.queueType, 'PUBLIC_SEARCH_DISCOVERY_REQUIRED');
  assert.equal(plan.terminalAction, 'GOOGLE_DISCOVERY');
  assert.equal(plan.searchEngine, 'google');
  assert.equal(plan.stages.find((stage) => stage.source === 'GOOGLE_BROWSER').enabled, true);
  assert.notEqual(plan.cacheKey, createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
  }));
});

test('search cache key includes absolute date range and strategy', () => {
  const a = createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
    absoluteDateFrom: '2026-04-01',
    absoluteDateTo: '2026-07-01',
  });
  const b = createSearchCacheKey({
    engine: 'baidu',
    query: '示例公司 招聘',
    locale: 'zh-CN',
    absoluteDateFrom: '2026-05-01',
    absoluteDateTo: '2026-07-01',
  });
  assert.notEqual(a, b);
});

test('verification task executes Direct HTTP then ATS then Playwright only as needed', async () => {
  const calls = [];
  const result = await executeVerificationTask({
    candidates: ['https://ats.example.com/jobs'],
  }, {
    directHttp: async () => {
      calls.push('direct');
      return { status: 'COMPLETED', completed: false, atsType: 'moka' };
    },
    atsAdapter: async () => {
      calls.push('ats');
      return { status: 'COMPLETED', completed: true };
    },
    playwrightFallback: async () => {
      calls.push('browser');
      return { completed: true };
    },
  });
  assert.deepEqual(calls, ['direct', 'ats']);
  assert.equal(result.method, 'ATS_ADAPTER');
});

test('local discovery excludes HTTP errors and preserves failed child observations', async () => {
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: '示例公司' },
    plan: {
      query: '示例公司 招聘',
      candidates: ['https://example.com/careers', 'https://example.com/jobs'],
      officialDomains: [],
      stages: [],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => {
      if (url.endsWith('/careers')) {
        return { status: 404, finalUrl: url, html: '<title>Not Found</title>' };
      }
      throw new Error('network failed');
    },
  });
  assert.equal(result.officialCandidates.length, 0);
  assert.equal(result.observations.length, 2);
  assert.equal(result.observations[1].fetchStatus, 'FAILED');
  assert.equal(result.status, 'COMPLETED');
});

test('local discovery uses bounded browser fallback after direct HTTP errors', async () => {
  const browserCalls = [];
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: 'Example Company' },
    plan: {
      query: 'Example Company recruitment',
      candidates: [
        'https://jobs.example.com/',
        'https://careers.example.com/',
      ],
      officialDomains: [],
      stages: [],
    },
    resolveAts: async () => null,
    fetchPage: async () => {
      throw new Error('direct transport failed');
    },
    observeWithBrowser: async (url) => {
      browserCalls.push(url);
      return {
        status: 200,
        finalUrl: url,
        title: 'Example Careers',
        html: '<html><title>Example Careers</title><body>Careers Jobs Apply</body></html>',
      };
    },
    maxBrowserFallbacks: 1,
  });

  assert.equal(browserCalls.length, 1);
  assert.equal(result.officialCandidates.length, 1);
  assert.equal(
    result.observations[0].observationMethod,
    'PLAYWRIGHT_FALLBACK_AFTER_HTTP_ERROR',
  );
  assert.match(result.observations[0].directFetchError, /transport failed/);
  assert.equal(result.observations[1].fetchStatus, 'FAILED');
});

test('local discovery uses browser fallback for direct access-control HTTP status', async () => {
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: 'Example Company' },
    plan: {
      query: 'Example Company recruitment',
      candidates: ['https://jobs.example.com/'],
      officialDomains: [],
      stages: [],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => ({
      status: 403,
      finalUrl: url,
      html: '<title>Forbidden</title>',
    }),
    observeWithBrowser: async (url) => ({
      status: 200,
      finalUrl: url,
      title: 'Example Careers',
      html: '<html><body>Careers Jobs Apply</body></html>',
    }),
  });

  assert.equal(result.officialCandidates.length, 1);
  assert.equal(
    result.observations[0].observationMethod,
    'PLAYWRIGHT_FALLBACK_AFTER_HTTP_STATUS',
  );
});

test('discovered recruitment links are prioritized and non-HTTP links are ignored', async () => {
  const visits = [];
  await discoverCompanyLocally({
    company: { id: 'company-1', company: 'Example Company' },
    plan: {
      query: 'Example Company recruitment',
      candidates: [
        'https://example.com/',
        'https://example.com/careers',
      ],
      officialDomains: [],
      stages: [],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => {
      visits.push(url);
      if (url === 'https://example.com/') {
        return {
          status: 200,
          finalUrl: url,
          html: [
            '<a href="https://ats.example.com/jobs">Campus recruitment</a>',
            '<a href="https://ats.example.com/apply/acme#/?type=social">Social recruitment</a>',
            '<a href="javascript:;">Recruitment menu</a>',
            '<a href="#jobs">Jobs section</a>',
          ].join(''),
        };
      }
      return {
        status: 200,
        finalUrl: url,
        html: '<title>Jobs</title><body>Jobs Apply</body>',
      };
    },
  });

  assert.equal(visits[0], 'https://example.com/');
  assert.match(visits[1], /^https:\/\/ats\.example\.com\//);
  assert.equal(visits.includes('javascript:;'), false);
  assert.equal(visits.includes('https://example.com/#jobs'), false);
  assert.equal(
    visits.includes('https://ats.example.com/apply/acme#/?type=social'),
    true,
  );
});

test('official outbound Moka links collapse to one attributed event directory', async () => {
  const visits = [];
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: 'Example Company' },
    plan: {
      query: 'Example Company recruitment',
      candidates: ['https://example.com/'],
      officialDomains: ['example.com'],
      stages: [{ source: 'KNOWN_OFFICIAL_DOMAIN', count: 1 }],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => {
      visits.push(url);
      if (url === 'https://example.com/') {
        return {
          status: 200,
          finalUrl: url,
          html: [
            '<a href="https://app.mokahr.com/social-recruitment/acme/123?locale=zh-CN#/jobs?page=1&amp;team=a">Social recruitment</a>',
            '<a href="https://app.mokahr.com/social-recruitment/acme/123?locale=zh-CN#/jobs?page=1&amp;team=b">Open jobs</a>',
          ].join(''),
        };
      }
      return {
        status: 200,
        finalUrl: url,
        html: '<title>Example Social Recruitment</title><body>Jobs Apply</body>',
      };
    },
  });

  assert.equal(
    visits.filter((url) => url === 'https://app.mokahr.com/social-recruitment/acme/123')
      .length,
    1,
  );
  const moka = result.officialCandidates.find((candidate) => (
    candidate.url === 'https://app.mokahr.com/social-recruitment/acme/123'
  ));
  assert.equal(moka.parentOfficialVerified, true);
  assert.equal(moka.officialAttributionUrl, 'https://example.com/');
  assert.equal(moka.discoveryReason, 'verified_official_outbound_ats_link');
});

test('one Moka job-filter probe enriches the event directory without becoming a portal', async () => {
  const directory = 'https://app.mokahr.com/campus-recruitment/acme/123';
  const filter = `${directory}?locale=zh-CN#/jobs/?page=1&team=engineering`;
  const result = await discoverCompanyLocally({
    company: { id: 'company-1', company: 'Example Company' },
    plan: {
      query: 'Example Company recruitment',
      candidates: [directory],
      officialDomains: [],
      stages: [{ source: 'VERIFIED_CAREER_PORTAL', count: 1 }],
    },
    resolveAts: async () => null,
    fetchPage: async (url) => {
      if (url === directory) {
        return {
          status: 200,
          finalUrl: directory,
          html: `<a href="${filter.replaceAll('&', '&amp;')}">Engineering jobs</a>`,
          jobs: [],
        };
      }
      return {
        status: 200,
        finalUrl: filter,
        html: '<title>Example Campus Jobs</title>',
        jobs: [{ title: 'AI Product Manager', sourceUrl: `${directory}/job/1` }],
      };
    },
  });

  assert.deepEqual(
    result.officialCandidates.map((candidate) => candidate.sourceUrl),
    [directory],
  );
  const directoryObservation = result.observations.find((item) => (
    item.requestedUrl === directory
  ));
  assert.equal(directoryObservation.jobs.length, 1);
  assert.equal(directoryObservation.jobExtractionSourceUrl, filter);
});

test('failed local evidence escalates only when search fallback is explicitly allowed', () => {
  const discovery = { status: 'FAILED', officialCandidates: [] };
  assert.equal(shouldEscalateLocalDiscovery({
    plan: { searchFallbackAllowed: true, confirmedPortalsOnly: false },
    discovery,
  }), true);
  assert.equal(shouldEscalateLocalDiscovery({
    plan: { searchFallbackAllowed: false, confirmedPortalsOnly: false },
    discovery,
  }), false);
  assert.equal(shouldEscalateLocalDiscovery({
    plan: { searchFallbackAllowed: true, confirmedPortalsOnly: true },
    discovery,
  }), false);
});

test('local and public-search discovery evidence is merged without duplicate URLs', () => {
  const result = mergeLocalAndSearchDiscovery({
    status: 'FAILED',
    reasonCode: 'local_candidates_unreachable',
    officialCandidates: [],
    observations: [{ url: 'https://old.example/' }],
    failures: [{ stage: 'LOCAL' }],
  }, {
    status: 'COMPLETED',
    officialCandidates: [{ url: 'https://jobs.example/' }],
    observations: [
      { url: 'https://old.example/' },
      { url: 'https://jobs.example/' },
    ],
    failures: [],
    liveSearchExecuted: true,
  }, {
    searchEngine: 'google',
  });

  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.liveSearchExecuted, true);
  assert.equal(result.discoveryProvider, 'local_then_chrome_google_visible_search');
  assert.equal(result.observations.length, 2);
  assert.equal(result.localDiscoveryReasonCode, 'local_candidates_unreachable');
});
