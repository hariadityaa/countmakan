import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimate, testKey, applyOrder, stepId } from '../js/chain.js';

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
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, timeoutMs: 20, cooldown: new Map() });
  assert.equal(out.model, 'd1');
  assert.equal(out.attempts[0].error, 'Timed out');
});

// Hangs until aborted, or answers after ms when given.
const hanging = (okAfterMs) => (url, init) => new Promise((resolve, reject) => {
  if (okAfterMs != null) setTimeout(() => resolve(res(200, geminiOk)), okAfterMs);
  init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
});

test('a step with a fallback left uses its short cap; the last step gets the full budget', async () => {
  const capped = [{ ...CHAIN[0], timeoutMs: 20 }, CHAIN[1]];
  const f = async (url, init) => (url.includes('g1') ? hanging()(url, init) : res(200, deepseekOk));
  const out = await estimate({ text: 'egg' }, KEYS, { chain: capped, fetchFn: f, timeoutMs: 5000, cooldown: new Map() });
  assert.equal(out.model, 'd1');
  assert.ok(out.attempts[0].ms < 1000);

  // Without a DeepSeek key, g1 is last, so the 20 ms cap does not apply.
  const solo = await estimate({ text: 'egg' }, { gemini: 'gk' }, { chain: capped, fetchFn: hanging(60), timeoutMs: 5000, cooldown: new Map() });
  assert.equal(solo.model, 'g1');
});

test('a model that timed out is skipped on the next scan while another can run', async () => {
  const cooldown = new Map();
  let t = 0;
  const clock = () => t;
  const f = async (url, init) => (url.includes('g1') ? hanging()(url, init) : res(200, deepseekOk));
  await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, timeoutMs: 20, cooldown, clock });

  const f2 = fakeFetch({ d1: res(200, deepseekOk) });
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f2, cooldown, clock });
  assert.deepEqual(f2.calls, ['d1']);
  assert.equal(out.attempts[0].skipped, 'timed out recently');

  // Only g1 usable: tried anyway.
  const f3 = fakeFetch({ g1: res(200, geminiOk) });
  assert.equal((await estimate({ text: 'egg' }, { gemini: 'gk' }, { chain: CHAIN.slice(0, 2), fetchFn: f3, cooldown, clock })).model, 'g1');

  // After ten minutes it is back, and a success clears it.
  t = 10 * 60 * 1000;
  const f4 = fakeFetch({ g1: res(200, geminiOk) });
  await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f4, cooldown, clock });
  assert.deepEqual(f4.calls, ['g1']);
  assert.equal(cooldown.size, 0);
});

test('retries a 503 once after everything failed', async () => {
  let n = 0;
  const f = async (url) => {
    if (url.includes('g1')) return ++n === 1 ? res(503, {}) : res(200, geminiOk);
    return res(500, {});
  };
  const out = await estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, retryDelayMs: 0 });
  assert.equal(out.model, 'g1');
  assert.deepEqual(out.attempts.map((a) => a.model), ['g1', 'd1', 'g2', 'g1']);

  const f2 = fakeFetch({ g1: res(503, {}), d1: res(500, {}), g2: res(500, {}) });
  await assert.rejects(estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f2, retryDelayMs: 0 }), /All providers failed/);
  assert.deepEqual(f2.calls, ['g1', 'd1', 'g2', 'g1']);
});

test('cancel during the 503 retry wait stops the scan', async () => {
  const ctrl = new AbortController();
  const f = fakeFetch({ g1: res(503, {}), d1: res(500, {}), g2: res(500, {}) });
  const p = estimate({ text: 'egg' }, KEYS, { chain: CHAIN, fetchFn: f, signal: ctrl.signal, retryDelayMs: 5000 });
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e) => e.kind === 'cancel' && e.attempts.length === 3);
  assert.equal(f.calls.length, 3);
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

test('each real attempt records how long it took', async () => {
  let t = 0;
  const now = () => t;
  const f = async (url, init) => {
    t += url.includes('g1') ? 60000 : 5000;
    return fakeFetch({ g1: res(503, {}), d1: res(200, deepseekOk) })(url, init);
  };
  const out = await estimate({ text: 'egg' }, { ...KEYS }, { chain: CHAIN, fetchFn: f, now });
  assert.deepEqual(out.attempts.map((a) => a.ms), [60000, 5000]);
});

test('skipped steps carry no time', async () => {
  const f = fakeFetch({ g1: res(200, geminiOk) });
  const out = await estimate({ text: 'egg' }, { gemini: 'gk' }, { chain: [CHAIN[1], CHAIN[0]], fetchFn: f });
  assert.equal(out.attempts[0].skipped, 'no key');
  assert.equal(out.attempts[0].ms, undefined);
  assert.equal(typeof out.attempts[1].ms, 'number');
});

test('applyOrder puts saved steps first, in saved order', () => {
  const ids = ['gemini:g2', 'deepseek:d1', 'gemini:g1'];
  assert.deepEqual(applyOrder(CHAIN, ids).map(stepId), ids);
});

test('applyOrder keeps new steps after saved ones and drops unknown ids', () => {
  const out = applyOrder(CHAIN, ['gemini:g2', 'gemini:gone']).map(stepId);
  assert.deepEqual(out, ['gemini:g2', 'gemini:g1', 'deepseek:d1']);
});

test('applyOrder with nothing saved keeps the default chain', () => {
  assert.equal(applyOrder(CHAIN, []), CHAIN);
  assert.equal(applyOrder(CHAIN, null), CHAIN);
});

test('estimate follows a reordered chain', async () => {
  const f = fakeFetch({ g2: res(200, geminiOk) });
  const out = await estimate({ text: 'egg' }, KEYS, { chain: applyOrder(CHAIN, ['gemini:g2']), fetchFn: f });
  assert.deepEqual(f.calls, ['g2']);
  assert.equal(out.model, 'g2');
});
