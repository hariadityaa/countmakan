import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, testKey } from '../js/chain.js';

const CHAIN = [
  { provider: 'gemini', model: 'g1', supports: ['text', 'image'] },
  { provider: 'deepseek', model: 'd1', supports: ['text'] },
  { provider: 'gemini', model: 'g2', supports: ['text', 'image'] },
];
const KEYS = { gemini: 'gk', deepseek: 'dk' };
const ITEMS = { items: [{ name: 'egg', grams: 50, kcal: 70, protein: 6, carbs: 0.5, fat: 5, confidence: 0.9 }] };

const geminiOk = { candidates: [{ content: { parts: [{ text: JSON.stringify(ITEMS) }] } }] };
const deepseekOk = { choices: [{ message: { content: JSON.stringify(ITEMS) } }] };

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// Responds per model id, read from the URL or body. Records the order of calls.
function fakeFetch(plan) {
  const calls = [];
  const fn = async (url, init) => {
    const model = url.includes('/models/') ? url.split('/models/')[1].split(':')[0] : JSON.parse(init.body).model;
    calls.push(model);
    const r = plan[model];
    if (r instanceof Error) throw r;
    return r;
  };
  fn.calls = calls;
  return fn;
}

test('first provider wins when it succeeds', async () => {
  const f = fakeFetch({ g1: res(200, geminiOk) });
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f });
  assert.equal(out.model, 'g1');
  assert.equal(out.provider, 'gemini');
  assert.equal(out.items[0].kcal, 70);
  assert.deepEqual(f.calls, ['g1']);
});

test('falls back on 429, 5xx and network errors', async () => {
  const f = fakeFetch({ g1: res(429, { error: { message: 'quota' } }), d1: res(503, {}), g2: res(200, geminiOk) });
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f });
  assert.equal(out.model, 'g2');
  assert.deepEqual(f.calls, ['g1', 'd1', 'g2']);
  assert.equal(out.attempts[0].status, 429);

  const f2 = fakeFetch({ g1: new TypeError('Failed to fetch'), d1: res(200, deepseekOk) });
  assert.equal((await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f2 })).model, 'd1');
});

test('falls back on unparseable model output', async () => {
  const bad = { candidates: [{ content: { parts: [{ text: 'sorry' }] } }] };
  const f = fakeFetch({ g1: res(200, bad), d1: res(200, deepseekOk) });
  assert.equal((await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f })).model, 'd1');
});

test('stops on a non-retryable error such as 400', async () => {
  const f = fakeFetch({ g1: res(400, { error: { message: 'bad request' } }) });
  await assert.rejects(estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f }), (e) => {
    assert.match(e.message, /g1: HTTP 400: bad request/);
    assert.equal(e.attempts.length, 1);
    return true;
  });
  assert.deepEqual(f.calls, ['g1']);
});

test('skips providers without a key or without image support', async () => {
  const f = fakeFetch({ g1: res(500, {}), g2: res(200, geminiOk) });
  const out = await estimate({ image: { mime: 'image/jpeg', base64: 'AA' } }, KEYS, { chain: CHAIN, fetchFn: f });
  assert.deepEqual(f.calls, ['g1', 'g2']);
  assert.equal(out.attempts[1].skipped, 'no image support');

  const f2 = fakeFetch({ d1: res(200, deepseekOk) });
  const out2 = await estimate({ text: 'egg' }, { deepseek: 'dk' }, { chain: CHAIN, fetchFn: f2 });
  assert.equal(out2.model, 'd1');
  assert.equal(out2.attempts[0].skipped, 'no key');
});

test('no keys gives a clear message', async () => {
  await assert.rejects(estimate({ text: 'egg' }, {}, { chain: CHAIN, fetchFn: fakeFetch({}) }), /Add an API key/);
});

test('all failing reports every attempt', async () => {
  const f = fakeFetch({ g1: res(429, {}), d1: res(502, {}), g2: res(500, {}) });
  await assert.rejects(estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f }), (e) => {
    assert.equal(e.message, 'All providers failed');
    assert.equal(e.attempts.length, 3);
    return true;
  });
});

test('times out a hung provider and moves on', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  const f = async (url, init) => (url.includes('g1') ? hang(url, init) : res(200, deepseekOk));
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, timeoutMs: 20 });
  assert.equal(out.model, 'd1');
  assert.equal(out.attempts[0].error, 'Timed out');
});

test('testKey reports success and failure', async () => {
  const ok = await testKey('deepseek', 'dk', { fetchFn: fakeFetch({ 'deepseek-flash': res(200, deepseekOk) }) });
  assert.equal(ok.ok, true);
  const bad = await testKey('deepseek', 'dk', { fetchFn: fakeFetch({ 'deepseek-flash': res(401, { error: { message: 'invalid key' } }) }) });
  assert.equal(bad.ok, false);
  assert.match(bad.message, /401/);
});

test('cancel stops the chain without trying the next provider', async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const f = (_url, init) => {
    calls++;
    return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  };
  const p = estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e) => e.kind === 'cancel');
  assert.equal(calls, 1);
});

test('onAttempt reports each real call and usage is returned', async () => {
  const seen = [];
  const f = fakeFetch({ g1: res(503, {}), d1: res(200, { ...deepseekOk, usage: { prompt_tokens: 900, completion_tokens: 80 } }) });
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, onAttempt: (s, i) => seen.push(`${i}:${s.model}`) });
  assert.deepEqual(seen, ['0:g1', '1:d1']);
  assert.deepEqual(out.usage, { input: 900, output: 80 });
});
