import { validatePlanningOutput } from '../../ports/llm-planner.mjs';

const MAX_INPUT_BYTES = 64 * 1024;
const MAX_OUTPUT_TOKENS = 2_000;

function validateEndpoint(endpoint) {
  if (!endpoint) return null;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error('LLM endpoint must be a valid HTTPS URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('LLM endpoint must use HTTPS');
  }
  return parsed.toString();
}

function parseContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('LLM response did not contain JSON content');
  }
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('LLM response content must be a JSON object');
  }
  return validatePlanningOutput(parsed);
}

export function createOpenAiCompatiblePlanningAdapter({
  endpoint = '',
  model = '',
  apiKey = '',
  timeoutMs = 30_000,
  fetcher = globalThis.fetch,
} = {}) {
  const normalizedEndpoint = validateEndpoint(String(endpoint || '').trim());
  const normalizedModel = String(model || '').trim();
  const configured = Boolean(normalizedEndpoint && normalizedModel);

  return Object.freeze({
    configured,
    async generate({ task, input } = {}) {
      if (!configured) throw new Error('planning model is not configured');
      if (typeof fetcher !== 'function') throw new Error('LLM fetcher is required');

      const prompt = JSON.stringify({ task, input });
      if (Buffer.byteLength(prompt, 'utf8') > MAX_INPUT_BYTES) {
        throw new Error('LLM planning input is too large');
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('LLM request timed out')),
        Math.max(1, Number(timeoutMs) || 30_000),
      );
      try {
        const headers = {
          accept: 'application/json',
          'content-type': 'application/json',
        };
        if (apiKey) headers.authorization = `Bearer ${apiKey}`;
        const response = await fetcher(normalizedEndpoint, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: normalizedModel,
            messages: [
              {
                role: 'system',
                content: [
                  'Return one JSON object only.',
                  'You may expand job keywords, create search queries, or add a neutral page advisory.',
                  'Never decide official identity, verification status, confidence score, evidence weight, or hard rejection.',
                ].join(' '),
              },
              { role: 'user', content: prompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0,
            max_tokens: MAX_OUTPUT_TOKENS,
          }),
        });
        if (!response.ok) {
          throw new Error(`LLM request failed with HTTP ${response.status}`);
        }
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error('LLM response body must be JSON');
        }
        return parseContent(payload);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
