import { test, expect } from '@playwright/test';
import { KEYS, NASI, geminiBody, mockModels, seedKeys, open, PLATE } from './helpers.js';

// Button labels must sit on one line. A wrapped label in a short button looks broken.
// Checked on a small Android phone (360px) and a common one (412px).

// Every visible button-like element whose label text breaks onto a second line.
function wrappedLabels() {
  const out = [];
  for (const b of document.querySelectorAll('button, .btn, summary')) {
    // Meal rows are list items, built to show two lines of food names.
    if (b.matches('.entry') || !b.checkVisibility()) continue;
    const range = document.createRange();
    const tops = new Set();
    const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (!n.textContent.trim()) continue;
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1) tops.add(Math.round(r.top));
    }
    if (tops.size > 1) out.push(b.textContent.trim().replace(/\s+/g, ' '));
  }
  return out;
}

const LONG = [
  { name: 'Nasi lemak with sambal, ikan bilis and egg', grams: 350, kcal: 650, protein: 18, carbs: 80, fat: 28, confidence: 0.4 },
  ...NASI,
];

for (const width of [360, 412]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test.beforeEach(async ({ page }) => seedKeys(page));

    test('no button label wraps on any screen', async ({ page }) => {
      await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(LONG) } });
      await open(page, `#setup?gemini=${KEYS.gemini}&deepseek=${KEYS.deepseek}`);
      await page.evaluate(() => {
        const e = new Event('beforeinstallprompt');
        e.prompt = async () => {};
        e.userChoice = Promise.resolve({ outcome: 'dismissed' });
        window.dispatchEvent(e);
      });
      expect.soft(await page.evaluate(wrappedLabels), 'home').toEqual([]);

      await page.setInputFiles('#upload', PLATE);
      expect.soft(await page.evaluate(wrappedLabels), 'photo check').toEqual([]);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await expect(page.locator('#editor-total')).toBeVisible();
      expect.soft(await page.evaluate(wrappedLabels), 'results').toEqual([]);
      await page.getByRole('button', { name: 'Save meal' }).click();
      expect.soft(await page.evaluate(wrappedLabels), 'saved').toEqual([]);

      await page.locator('#today-list .entry').first().click();
      expect.soft(await page.evaluate(wrappedLabels), 'edit meal').toEqual([]);
      await page.getByRole('button', { name: 'Cancel' }).click();

      await page.getByRole('button', { name: 'Type it in' }).click();
      expect.soft(await page.evaluate(wrappedLabels), 'type it in').toEqual([]);

      await page.locator('nav button[data-tab=history]').click();
      expect.soft(await page.evaluate(wrappedLabels), 'history').toEqual([]);

      await page.locator('nav button[data-tab=settings]').click();
      await page.locator('#setup summary').click();
      expect.soft(await page.evaluate(wrappedLabels), 'settings').toEqual([]);
    });

    test('no button label wraps on the failure and loading screens', async ({ page }) => {
      await mockModels(page, { 'gemini-3.8-flash': 'hang' });
      await open(page);
      await page.setInputFiles('#upload', PLATE);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await expect(page.locator('#loading')).toBeVisible();
      expect.soft(await page.evaluate(wrappedLabels), 'loading').toEqual([]);
      await page.getByRole('button', { name: 'Stop and go back' }).click();
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await mockModels(page, {});
      await page.setInputFiles('#upload', PLATE);
      await page.getByRole('button', { name: 'Count calories' }).click();
      await expect(page.locator('#failure')).toBeVisible();
      expect.soft(await page.evaluate(wrappedLabels), 'failure').toEqual([]);
    });
  });
}
