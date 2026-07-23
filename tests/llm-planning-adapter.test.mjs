import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createOpenAiCompatiblePlanningAdapter,
} from '../src/adapters/llm/openai-compatible-planning-adapter.mjs';

test('adapter is not configured without endpoint and model', () => {
  const adapter = createOpenAiCompatiblePlanningAdapter({ endpoint: '', model: '' });
  assert.equal(adapter.configured, false);
});

test('adapter requires an explicitly configured HTTPS endpoint', () => {
  assert.throws(() => createOpenAiCompatiblePlanningAdapter({
    endpoint: 'http://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
  }), /HTTPS/);
});

test('adapter sends a bounded JSON request and parses JSON content', async () => {
  const calls = [];
  const adapter = createOpenAiCompatiblePlanningAdapter({
    endpoint: 'https://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
    apiKey: 'fixture-secret',
    fetcher: async (url, options) => {
      const headers = new Headers(options.headers);
      const body = JSON.parse(options.body);
      calls.push({
        url,
        method: options.method,
        authorization: headers.has('authorization') ? 'configured' : 'not_configured',
        responseFormat: body.response_format,
        maxTokens: body.max_tokens,
      });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"terms":["AI 产品经理"]}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await adapter.generate({
    task: 'expand_keywords',
    input: { roleType: 'AI 产品经理' },
  });

  assert.deepEqual(result, { terms: ['AI 产品经理'] });
  assert.equal(calls[0].responseFormat.type, 'json_object');
  assert.ok(calls[0].maxTokens <= 2_000);
  assert.doesNotMatch(JSON.stringify(calls), /fixture-secret/);
});

test('adapter rejects planning output that claims verification authority', async () => {
  const adapter = createOpenAiCompatiblePlanningAdapter({
    endpoint: 'https://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
    fetcher: async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"isOfficial":true}' } }],
    }), { status: 200 }),
  });

  await assert.rejects(
    adapter.generate({ task: 'plan_queries', input: {} }),
    /forbidden LLM field/,
  );
});

test('adapter caches replaceable planning calls and records observed token cost', async () => {
  const values = new Map();
  const usage = [];
  let requests = 0;
  const adapter = createOpenAiCompatiblePlanningAdapter({
    endpoint: 'https://llm.example.test/v1/chat/completions',
    model: 'fixture-model',
    inputUsdPerMillionTokens: 2,
    outputUsdPerMillionTokens: 8,
    cache: {
      get: (key) => values.get(key),
      set: (key, value) => values.set(key, value),
    },
    usageRecorder: (record) => usage.push(record),
    fetcher: async () => {
      requests += 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"terms":["Backend Engineer"]}' } }],
        usage: { prompt_tokens: 100, completion_tokens: 25 },
      }), { status: 200 });
    },
  });

  const input = { task: 'expand_keywords', input: { roleType: '后端开发' } };
  assert.deepEqual(await adapter.generate(input), { terms: ['Backend Engineer'] });
  assert.deepEqual(await adapter.generate(input), { terms: ['Backend Engineer'] });

  assert.equal(requests, 1);
  assert.equal(usage.length, 2);
  assert.equal(usage[0].cacheHit, false);
  assert.equal(usage[0].costUsd, 0.0004);
  assert.equal(usage[1].cacheHit, true);
  assert.equal(usage[1].costUsd, 0);
  assert.doesNotMatch(JSON.stringify(usage), /fixture-secret/);
});
