import assert from 'node:assert/strict';
import test from 'node:test';

import { searchCompany } from '../src/pipeline/search-company.mjs';

test('NA company search ranks an owned careers page above job boards', async () => {
  const router = {
    search: async () => ({
      status: 'ok',
      provider: 'fixture',
      attempts: [],
      items: [
        {
          title: 'Stripe Jobs',
          url: 'https://stripe.com/jobs/search',
          snippet: 'Explore open positions and internships at Stripe.',
        },
        {
          title: 'Stripe jobs on LinkedIn',
          url: 'https://www.linkedin.com/company/stripe/jobs',
          snippet: 'Third-party job board.',
        },
      ],
    }),
  };
  const result = await searchCompany({
    market: 'NA',
    company: 'Stripe',
    router,
    maxQueries: 2,
  });
  assert.equal(result.status, 'candidates_found');
  assert.equal(result.candidates[0].url, 'https://stripe.com/jobs/search');
  assert.equal(result.candidates[0].owned, true);
});

