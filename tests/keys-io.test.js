import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSetupFragment, buildSetupLink, loadKeys, saveKeys, maskKey } from '../js/keys.js';
import { buildExport, parseImport, localDay } from '../js/io.js';

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('setup link round-trips keys with special characters', () => {
  const keys = { gemini: 'AIza+abc/def=', deepseek: 'sk-123' };
  const link = buildSetupLink('https://x.github.io/countmakan/#old', keys);
  assert.ok(link.startsWith('https://x.github.io/countmakan/#setup?'));
  assert.deepEqual(parseSetupFragment(link.slice(link.indexOf('#'))), keys);
});

test('parseSetupFragment ignores other fragments and empty values', () => {
  assert.equal(parseSetupFragment(''), null);
  assert.equal(parseSetupFragment('#history'), null);
  assert.equal(parseSetupFragment('#setup?gemini='), null);
  assert.deepEqual(parseSetupFragment('#setup?deepseek=sk-1&evil=x'), { deepseek: 'sk-1' });
});

test('saveKeys trims and drops unknown providers', () => {
  const s = memStorage();
  saveKeys({ gemini: '  g  ', other: 'x' }, s);
  assert.deepEqual(loadKeys(s), { gemini: 'g' });
  assert.deepEqual(loadKeys(memStorage()), {});
});

test('maskKey hides the middle', () => {
  assert.equal(maskKey(''), 'not set');
  assert.equal(maskKey('AIzaSyABCDEFGH1234'), 'AIza••••1234');
});

test('export then import keeps entries', () => {
  const entry = {
    id: 'a1', ts: '2026-10-12T04:30:00.000Z', day: 'ignored', provider: 'gemini', model: 'gemini-3.8-flash',
    source: 'photo', text: '', thumb: 'data:image/jpeg;base64,AA',
    items: [{ name: 'Mee goreng', grams: 350, kcal: 600, protein: 18, carbs: 80, fat: 22, confidence: 0.7 }],
  };
  const file = JSON.stringify(buildExport([entry], { kcal: 1700 }));
  const { entries, targets } = parseImport(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].model, 'gemini-3.8-flash');
  assert.equal(entries[0].day, localDay(entry.ts));
  assert.deepEqual(entries[0].items, entry.items);
  assert.deepEqual(targets, { kcal: 1700 });
});

test('import rejects foreign files and skips bad entries', () => {
  assert.throws(() => parseImport('nope'), /valid JSON/);
  assert.throws(() => parseImport('{"entries":[]}'), /Not a countmakan export/);
  const { entries } = parseImport(JSON.stringify({
    app: 'countmakan',
    entries: [{ id: 1, ts: 'x' }, { id: 'ok', ts: '2026-01-01T00:00:00Z', thumb: 'javascript:alert(1)' }],
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].thumb, '');
  assert.equal(entries[0].provider, 'manual');
});

test('localDay formats local dates', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});
