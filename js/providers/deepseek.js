import { ENDPOINTS } from '../config.js';
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
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    },
  };
}

export function extractText(json) {
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new OutputError('Empty response');
  return text;
}

export function errorDetail(json) {
  return json?.error?.message || '';
}
