import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFailure, scanSummary, MSG } from '../js/messages.js';

const fail = (...attempts) => Object.assign(new Error('All providers failed'), { attempts });
const a = (kind, status = 0, error = 'x') => ({ model: 'm', kind, status, error });

test('offline when the browser says so', () => {
  assert.equal(describeFailure(fail(a('http', 503)), false).kind, 'offline');
});

test('offline when every call was a network error', () => {
  assert.equal(describeFailure(fail(a('network'), a('network'))).text, MSG.offline);
});

test('busy on 503, 429 and timeouts', () => {
  assert.equal(describeFailure(fail(a('http', 503), a('http', 429), a('timeout'))).kind, 'busy');
});

test('setup on a bad key, or when no provider had a key', () => {
  assert.equal(describeFailure(fail(a('http', 401))).kind, 'setup');
  assert.equal(describeFailure(fail({ model: 'm', skipped: 'no key' })).kind, 'setup');
});

test('unreadable when every answer was garbled', () => {
  assert.equal(describeFailure(fail(a('output'), a('output'))).kind, 'unreadable');
});

test('details list each attempt for Hari, text stays plain', () => {
  const d = describeFailure(fail(a('http', 503, 'HTTP 503: overloaded'), { ...a('timeout'), model: 'd', error: 'Timed out' }));
  assert.equal(d.details, 'm: HTTP 503: overloaded\nd: Timed out');
  assert.doesNotMatch(d.text, /HTTP|model|API|key/i);
});

test('scanSummary shows each step, its time, the photo size and thinking', () => {
  const attempts = [
    { model: 'flash', kind: 'timeout', error: 'Timed out', ms: 60000 },
    { model: 'lite', ok: true, ms: 6240 },
  ];
  assert.equal(
    scanSummary(attempts, { photoBytes: 348 * 1024, usage: { input: 1500, output: 1700, thinking: 1200 } }),
    'flash timed out after 60.0 s → lite 6.2 s · photo 348 KB · 1,200 thinking tokens',
  );
});

test('scanSummary skips steps with no key and names HTTP failures', () => {
  const attempts = [
    { model: 'ds', skipped: 'no key' },
    { model: 'flash', kind: 'http', status: 503, error: 'busy', ms: 900 },
    { model: 'lite', ok: true, ms: 4000 },
  ];
  assert.equal(scanSummary(attempts), 'flash failed (503) after 0.9 s → lite 4.0 s');
});

test('failure details include time per attempt', () => {
  const d = describeFailure(fail({ model: 'flash', kind: 'timeout', error: 'Timed out', ms: 60000 })).details;
  assert.equal(d, 'flash: Timed out (60.0 s)');
});

test('scanSummary names a model skipped for timing out recently', () => {
  const attempts = [
    { model: 'flash', skipped: 'no key' },
    { model: 'lite', skipped: 'timed out recently' },
    { model: 'ds', ok: true, ms: 2700 },
  ];
  assert.equal(scanSummary(attempts), 'lite skipped (timed out recently) → ds 2.7 s');
});
