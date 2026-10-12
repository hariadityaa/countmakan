import { ENDPOINTS, MAX_OUTPUT_TOKENS } from '../config.js';
import { SYSTEM_PROMPT, userText } from '../prompt.js';
import { OutputError } from '../schema.js';

export function buildRequest(model, input, key) {
  const text = userText(input.text, !!input.image);
  const content = input.image
    ? [
        { type: 'text', text },
        { type: 'image_url', image_url: { url: `data:${input.image.mime};base64,${input.image.base64}` } },
      ]
    : text;
  return {
    url: ENDPOINTS.deepseek,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    },
  };
}

export function extractText(json) {
  const choice = json?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new OutputError('Answer cut off at the token limit');
  const text = choice?.message?.content;
  if (!text) throw new OutputError('Empty response');
  return text;
}

export function errorDetail(json) {
  return json?.error?.message || '';
}

export function extractUsage(json) {
  const u = json?.usage;
  if (!u) return null;
  // output already includes reasoning. reasoning is kept apart to size MAX_OUTPUT_TOKENS.
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  return { input: u.prompt_tokens || 0, output: u.completion_tokens || 0, ...(reasoning ? { reasoning } : {}) };
}
