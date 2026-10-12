import { ENDPOINTS } from '../config.js';
import { SYSTEM_PROMPT, userText } from '../prompt.js';
import { RESPONSE_SCHEMA, OutputError } from '../schema.js';

export function buildRequest(model, input, key) {
  const parts = [{ text: userText(input.text, !!input.image) }];
  if (input.image) parts.push({ inline_data: { mime_type: input.image.mime, data: input.image.base64 } });
  return {
    url: `${ENDPOINTS.gemini}/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    },
  };
}

export function extractText(json) {
  const cand = json?.candidates?.[0];
  if (!cand) {
    const reason = json?.promptFeedback?.blockReason;
    throw new OutputError(reason ? `Blocked: ${reason}` : 'No candidates returned');
  }
  const text = (cand.content?.parts || [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
  if (!text) throw new OutputError(`Empty response (${cand.finishReason || 'unknown'})`);
  return text;
}

export function errorDetail(json) {
  return json?.error?.message || '';
}

export function extractUsage(json) {
  const u = json?.usageMetadata;
  return u ? { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) } : null;
}
