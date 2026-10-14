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
  const fav = { id: 'f1', name: 'Mee goreng', items: entry.items, thumb: '', ts: '2026-10-12T04:31:00.000Z' };
  const file = JSON.stringify(buildExport([entry], { kcal: 1700 }, [fav]));
  const { entries, targets, favourites } = parseImport(file);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].model, 'gemini-3.8-flash');
  assert.equal(entries[0].day, localDay(entry.ts));
  assert.deepEqual(entries[0].items, [{ ...entry.items[0], sugar: 0, fibre: 0, sodium: 0 }]);
  assert.deepEqual(targets, { kcal: 1700 });
  assert.equal(favourites.length, 1);
  assert.equal(favourites[0].name, 'Mee goreng');
});

test('export leaves full photos out', () => {
  const entry = { id: 'a2', ts: '2026-10-12T04:30:00.000Z', items: [], photo: { size: 123 }, thumb: 'data:image/jpeg;base64,AA' };
  const out = buildExport([entry], {});
  assert.equal('photo' in out.entries[0], false);
  assert.equal(out.entries[0].thumb, entry.thumb);
});

test('import rejects foreign files and skips bad entries', () => {
  assert.throws(() => parseImport('nope'), /valid JSON/);
  assert.throws(() => parseImport('{"entries":[]}'), /Not a Makan Meter export/);
  const { entries } = parseImport(JSON.stringify({
    app: 'countmakan',
    entries: [{ id: 1, ts: 'x' }, { id: 'ok', ts: '2026-01-01T00:00:00Z', thumb: 'javascript:alert(1)' }],
  }));
  assert.equal(entries.length, 1);
  assert.equal(entries[0].thumb, '');
  assert.equal(entries[0].provider, 'manual');
});

test('version 1 copies without favourites still restore', () => {
  const { entries, favourites } = parseImport(JSON.stringify({ app: 'countmakan', version: 1, entries: [] }));
  assert.deepEqual(entries, []);
  assert.deepEqual(favourites, []);
});

test('localDay formats local dates', () => {
  assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('gemini-only setup link round-trips without deepseek', () => {
  const link = buildSetupLink('https://x.test/app/', { gemini: 'AIza1' });
  assert.deepEqual(parseSetupFragment(link.slice(link.indexOf('#'))), { gemini: 'AIza1' });
});
