// Live end-to-end run: real photos, real model calls, deployed site.
// Keys come from env and go straight into localStorage. They are never logged.
import { test, expect } from '@playwright/test';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = process.env.LIVE_OUT || 'live-results';
const UA = 'countmakan-e2e/1.0 (https://github.com/hariadityaa/countmakan)';

// Plausible calorie ranges for a typical serving. Outside the range is flagged, not failed.
const CASES = [
  { id: 'nasi-lemak', search: 'nasi lemak', range: [500, 900] },
  { id: 'soto-ayam', search: 'soto ayam', range: [250, 650] },
  { id: 'mixed-rice', search: 'nasi campur', range: [450, 1000] },
  { id: 'text-eggs-teh', text: '2 boiled eggs and a cup of teh tarik', range: [220, 450] },
];

const results = [];

// Finds a JPEG on Wikimedia Commons whose title matches, and returns an 800 px copy.
async function commonsPhoto(query) {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({
    action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '10',
    gsrsearch: `intitle:"${query}" filemime:image/jpeg`, prop: 'imageinfo', iiprop: 'url|extmetadata',
    iiurlwidth: '800', iiextmetadatafilter: 'LicenseShortName|Artist',
  }).forEach(([k, v]) => api.searchParams.set(k, v));
  const res = await fetch(api, { headers: { 'user-agent': UA } });
  const pages = Object.values((await res.json()).query?.pages || {}).sort((a, b) => a.index - b.index);
  if (!pages.length) throw new Error(`No Commons photo for "${query}"`);
  const p = pages[0];
  const info = p.imageinfo[0];
  const img = await fetch(info.thumburl || info.url, { headers: { 'user-agent': UA } });
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
  return {
    buffer: Buffer.from(await img.arrayBuffer()),
    source: `${p.title} (${strip(info.extmetadata?.LicenseShortName?.value)}, ${strip(info.extmetadata?.Artist?.value)}) ${info.descriptionurl}`,
  };
}

function readLatestEntry() {
  return new Promise((res) => {
    const r = indexedDB.open('countmakan', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('entries').objectStore('entries').getAll();
      q.onsuccess = () => res(q.result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]);
    };
  });
}

test.beforeAll(async () => {
  await mkdir(OUT, { recursive: true });
  for (const k of ['GEMINI_API_KEY', 'DEEPSEEK_API_KEY']) if (!process.env[k]) throw new Error(`${k} is not set`);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((keys) => localStorage.setItem('countmakan.keys', JSON.stringify(keys)), {
    gemini: process.env.GEMINI_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  });
});

test('deployed build', async ({ request }) => {
  const sw = await (await request.get('sw.js')).text();
  const cache = sw.match(/countmakan-[\w-]+/)?.[0];
  results.push({ id: 'build', cache });
  if (process.env.EXPECT_SHA) expect(cache).toBe(`countmakan-${process.env.EXPECT_SHA.slice(0, 7)}`);
});

for (const c of CASES) {
  test(c.id, async ({ page }) => {
    await page.goto('');
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    let source = 'typed text';
    if (c.search) {
      const photo = await commonsPhoto(c.search);
      source = photo.source;
      const file = join(OUT, `${c.id}-input.jpg`);
      await writeFile(file, photo.buffer);
      await page.setInputFiles('#upload', file);
    } else {
      await page.getByRole('button', { name: 'Type what you ate' }).click();
      await page.getByLabel('Describe your food').fill(c.text);
    }
    await page.getByRole('button', { name: 'Count calories' }).click();
    const outcome = await Promise.race([
      page.waitForSelector('#editor:not([hidden])', { timeout: 220000 }).then(() => 'ok'),
      page.waitForSelector('#failure:not([hidden])', { timeout: 220000 }).then(() => 'failed'),
    ]);
    await page.screenshot({ path: join(OUT, `${c.id}-result.png`), fullPage: true });
    if (outcome === 'failed') {
      await page.getByText('Details').click();
      const details = await page.locator('#failure-details').textContent();
      results.push({ id: c.id, source, error: details });
      throw new Error(`${c.id} failed: ${details}`);
    }
    await page.getByRole('button', { name: 'Save meal' }).click();
    await expect(page.locator('#toast')).toContainText('Meal saved');
    await page.screenshot({ path: join(OUT, `${c.id}-saved.png`) });
    const e = await page.evaluate(readLatestEntry);
    const t = e.items.reduce((a, i) => ({ kcal: a.kcal + i.kcal, protein: a.protein + i.protein, carbs: a.carbs + i.carbs, fat: a.fat + i.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
    const plausible = t.kcal >= c.range[0] && t.kcal <= c.range[1];
    results.push({
      id: c.id, source, provider: e.provider, model: e.model, seconds: +(e.ms / 1000).toFixed(1), usage: e.usage,
      kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat),
      range: c.range, plausible, items: e.items.map((i) => `${i.name} ${i.grams} g ${i.kcal} kcal (conf ${i.confidence})`),
    });
  });
}

test.afterAll(async () => {
  await writeFile(join(OUT, 'results.json'), JSON.stringify(results, null, 2));
  const rows = results.filter((r) => r.id !== 'build').map((r) => (r.error
    ? `| ${r.id} | failed | | | | ${r.error.replace(/\n/g, '<br>')} |`
    : `| ${r.id} | ${r.model} | ${r.seconds} s | ${r.usage ? `${r.usage.input} in / ${r.usage.output} out` : 'n/a'} | ${r.kcal} kcal, P ${r.protein} C ${r.carbs} F ${r.fat} | ${r.plausible ? 'ok' : `**check** (expected ${r.range.join('–')})`} |`));
  const md = [
    `### countmakan live run`,
    `Build: \`${results.find((r) => r.id === 'build')?.cache}\``,
    '',
    '| Case | Answered by | Time | Tokens | Totals | Plausible |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
    ...results.filter((r) => r.source).map((r) => `- ${r.id}: ${r.source}`),
  ].join('\n');
  await writeFile(join(OUT, 'summary.md'), md);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
  console.log(md);
});
