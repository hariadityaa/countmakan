import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as gemini from '../js/providers/gemini.js';
import * as deepseek from '../js/providers/deepseek.js';
import { OutputError } from '../js/schema.js';

const IMG = { mime: 'image/jpeg', base64: 'AAAA' };

test('gemini request carries inline_data, schema and key header', () => {
  const { url, init } = gemini.buildRequest('gemini-x', { text: 'half portion', image: IMG }, 'K1');
  assert.match(url, /\/models\/gemini-x:generateContent$/);
  assert.equal(init.headers['x-goog-api-key'], 'K1');
  const body = JSON.parse(init.body);
  assert.deepEqual(body.contents[0].parts[1], { inline_data: { mime_type: 'image/jpeg', data: 'AAAA' } });
  assert.match(body.contents[0].parts[0].text, /half portion/);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.ok(body.generationConfig.responseSchema.properties.items);
  assert.ok(body.system_instruction.parts[0].text.length > 100);
});

test('gemini text-only request has one part', () => {
  const body = JSON.parse(gemini.buildRequest('m', { text: 'soto ayam' }, 'k').init.body);
  assert.equal(body.contents[0].parts.length, 1);
});

test('gemini extractText skips thought parts', () => {
  const json = { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: '{"items":[]}' }] } }] };
  assert.equal(gemini.extractText(json), '{"items":[]}');
});

test('gemini extractText reports blocks and empties', () => {
  assert.throws(() => gemini.extractText({ promptFeedback: { blockReason: 'SAFETY' } }), /SAFETY/);
  assert.throws(() => gemini.extractText({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [] } }] }), OutputError);
});

test('deepseek request uses json mode, bearer auth and data URL', () => {
  const { url, init } = deepseek.buildRequest('deepseek-x', { text: '', image: IMG }, 'K2');
  assert.equal(url, 'https://api.deepseek.com/chat/completions');
  assert.equal(init.headers.authorization, 'Bearer K2');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'deepseek-x');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /json/i, 'json mode needs the word json in the prompt');
  assert.equal(body.messages[1].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
});

test('deepseek text-only request sends a string', () => {
  const body = JSON.parse(deepseek.buildRequest('m', { text: 'bakso' }, 'k').init.body);
  assert.equal(typeof body.messages[1].content, 'string');
});

test('deepseek extractText', () => {
  assert.equal(deepseek.extractText({ choices: [{ message: { content: '{}' } }] }), '{}');
  assert.throws(() => deepseek.extractText({ choices: [] }), OutputError);
});
