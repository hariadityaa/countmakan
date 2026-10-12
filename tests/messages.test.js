import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeFailure, MSG } from '../js/messages.js';

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
