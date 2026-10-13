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

test('deepseek extractText rejects an answer cut off at the token limit', () => {
  const json = { choices: [{ finish_reason: 'length', message: { content: '{"items":[{"name":"ri' } }] };
  assert.throws(() => deepseek.extractText(json), /cut off/);
});

test('deepseek extractUsage keeps reasoning tokens apart', () => {
  const usage = { prompt_tokens: 1500, completion_tokens: 600, completion_tokens_details: { reasoning_tokens: 400 } };
  assert.deepEqual(deepseek.extractUsage({ usage }), { input: 1500, output: 600, reasoning: 400 });
  assert.deepEqual(deepseek.extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5 } }), { input: 10, output: 5 });
});

test('user text carries follow-up answers and confirmed portions', () => {
  const input = {
    text: 'lunch',
    image: IMG,
    answers: [{ q: 'How much rice?', a: 'Half plate' }],
    refs: [{ name: 'Chicken rice', grams: 350, kcal: 600 }],
  };
  const text = JSON.parse(gemini.buildRequest('m', input, 'k').init.body).contents[0].parts[0].text;
  assert.match(text, /Notes from the eater: lunch/);
  assert.match(text, /You asked: "How much rice\?" The eater answered: "Half plate"/);
  assert.match(text, /- Chicken rice: 350 g, 600 kcal/);
  const ds = JSON.parse(deepseek.buildRequest('m', { text: 'bakso', refs: input.refs }, 'k').init.body);
  assert.match(ds.messages[1].content, /Meal description: bakso\nPortions this eater has confirmed before:/);
});

test('gemini schema asks for sugar, fibre, sodium and an optional question', () => {
  const schema = JSON.parse(gemini.buildRequest('m', { text: 'x' }, 'k').init.body).generationConfig.responseSchema;
  for (const f of ['sugar', 'fibre', 'sodium']) assert.ok(schema.properties.items.items.required.includes(f));
  assert.ok(schema.properties.question);
  assert.ok(!schema.required.includes('question'));
});
