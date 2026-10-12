import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { KEYS, NASI, geminiBody, deepseekBody, mockModels, seedKeys, open, photoEstimate } from './helpers.js';

const OK = { status: 200, body: geminiBody(NASI) };
const busy = (status) => ({ status, body: { error: { message: 'The model is overloaded' } } });

test('without keys the app asks for the setup link', async ({ page }) => {
  await open(page);
  await expect(page.getByText('Ask Hari to send you the setup link.')).toBeVisible();
  await expect(page.locator('#hero')).toBeHidden();
});

test('setup link saves keys, strips them from the address and shows the home screen', async ({ page }) => {
  await open(page, `#setup?gemini=${KEYS.gemini}&deepseek=${KEYS.deepseek}`);
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.getByText("You're all set.")).toBeVisible();
  await expect(page.getByText('Count your calories with a photo')).toBeVisible();
  expect(page.url()).not.toContain('gemini=');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('countmakan.keys')));
  expect(saved).toEqual(KEYS);
});

test.describe('with keys', () => {
  test.beforeEach(async ({ page }) => seedKeys(page));

  test('photo estimate shows results with a check badge on low confidence', async ({ page }) => {
    const calls = await mockModels(page, { 'gemini-3.8-flash': OK });
    await open(page);
    await photoEstimate(page);
    await expect(page.getByRole('heading', { name: "Here's what we found" })).toBeVisible();
    await expect(page.locator('#editor-total')).toHaveText('Total: 445 calories');
    await expect(page.locator('.badge')).toHaveCount(1);
    await expect(page.locator('.item').nth(1).locator('.badge')).toHaveText('Please check this');
    expect(calls).toEqual(['gemini-3.8-flash']);
  });

  test('choosing another photo before sending costs no call', async ({ page }) => {
    const calls = await mockModels(page, { 'gemini-3.8-flash': OK });
    await open(page);
    await page.setInputFiles('#upload', new URL('./fixtures/plate.jpg', import.meta.url).pathname);
    await page.setInputFiles('#replace', new URL('./fixtures/plate.jpg', import.meta.url).pathname);
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#hero')).toBeVisible();
    expect(calls).toEqual([]);
  });

  test('text estimate', async ({ page }) => {
    const items = [{ name: 'Telur rebus', grams: 100, kcal: 155, protein: 13, carbs: 1, fat: 11, confidence: 0.95 }];
    await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(items) } });
    await open(page);
    await page.getByRole('button', { name: 'Type what you ate' }).click();
    await page.getByLabel('Describe your food').fill('2 boiled eggs');
    await page.getByRole('button', { name: 'Count calories' }).click();
    await expect(page.locator('#editor-total')).toHaveText('Total: 155 calories');
    await expect(page.locator('.badge')).toHaveCount(0);
  });

  test('empty text asks the user to type something, without a call', async ({ page }) => {
    const calls = await mockModels(page, {});
    await open(page);
    await page.getByRole('button', { name: 'Type what you ate' }).click();
    await page.getByRole('button', { name: 'Count calories' }).click();
    await expect(page.getByText('Please type what you ate.')).toBeVisible();
    expect(calls).toEqual([]);
  });

  test('Gemini 503 then 429 falls back to DeepSeek', async ({ page }) => {
    const calls = await mockModels(page, {
      'gemini-3.8-flash': busy(503),
      'gemini-3.5-flash-lite': busy(429),
      'deepseek-flash': { status: 200, body: deepseekBody(NASI) },
    });
    await open(page);
    await photoEstimate(page);
    await expect(page.locator('#editor-total')).toHaveText('Total: 445 calories');
    expect(calls).toEqual(['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'deepseek-flash']);
    await page.getByRole('button', { name: 'Save meal' }).click();
    const [entry] = await page.evaluate(readEntries);
    expect(entry.provider).toBe('deepseek');
    expect(entry.usage).toEqual({ input: 900, output: 130 });
  });

  test('loading says what is happening, and says so again on fallback', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': busy(503), 'gemini-3.5-flash-lite': 'hang' });
    await open(page);
    await photoEstimate(page);
    await expect(page.getByText('Trying another way.')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Is this the right photo?' })).toBeVisible();
  });

  test('all providers failing shows one plain sentence, detail behind a toggle', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': busy(503), 'gemini-3.5-flash-lite': busy(503), 'deepseek-flash': busy(500) });
    await open(page);
    await photoEstimate(page);
    await expect(page.locator('#failure-text')).toHaveText('The food checker is busy right now. Try again in a minute.');
    await expect(page.locator('#failure-details')).toBeHidden();
    await page.getByText('Details').click();
    await expect(page.locator('#failure-details')).toContainText('deepseek-flash: HTTP 500');
    await expect(page.locator('#failure-text')).not.toContainText(/HTTP|API|model/);
  });

  test('a bad key tells the user to ask Hari', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': { status: 400, body: { error: { message: 'API key not valid' } } } });
    await open(page);
    await photoEstimate(page);
    await expect(page.locator('#failure-text')).toHaveText('The app needs fixing. Please tell Hari.');
  });

  test('editing grams rescales calories, protein, carbs and fat', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': OK });
    await open(page);
    await photoEstimate(page);
    await page.locator('#item-0-grams').fill('300');
    await page.locator('#item-0-grams').press('Tab');
    await expect(page.locator('#item-0-kcal')).toHaveValue('390');
    await expect(page.locator('#item-0-protein')).toHaveValue('8');
    await expect(page.locator('#item-0-carbs')).toHaveValue('86');
    await expect(page.locator('#item-0-fat')).toHaveValue('0.8');
    await expect(page.locator('#editor-total')).toHaveText('Total: 640 calories');
  });

  test('save, reload, history, delete and undo', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': OK });
    await open(page);
    await photoEstimate(page);
    await page.getByRole('button', { name: 'Save meal' }).click();
    await expect(page.locator('#toast')).toHaveText(/Meal saved/);
    await expect(page.locator('#summary .big-num')).toContainText('445');

    await page.reload();
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    await expect(page.locator('#today-list .entry')).toHaveCount(1);
    await expect(page.getByText('Count your calories with a photo')).toBeHidden();

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('#history .day-total')).toHaveText('445 calories');

    await page.locator('#history .entry').click();
    await expect(page.getByRole('heading', { name: 'Change this meal' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete this meal' }).click();
    await expect(page.locator('#toast')).toContainText('Meal deleted.');
    await expect(page.locator('#today-list .entry')).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#today-list .entry')).toHaveCount(1);
    expect(await page.evaluate(readEntries)).toHaveLength(1);
  });

  test('backup round trip: save a copy, wipe, restore', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': OK });
    await open(page);
    await photoEstimate(page);
    await page.getByRole('button', { name: 'Save meal' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a copy' }).click()]);
    const file = await download.path();
    const data = JSON.parse(await readFile(file, 'utf8'));
    expect(data.entries).toHaveLength(1);

    await page.evaluate(() => new Promise((res) => {
      const r = indexedDB.open('countmakan', 1);
      r.onsuccess = () => {
        const t = r.result.transaction('entries', 'readwrite');
        t.objectStore('entries').clear();
        t.oncomplete = res;
      };
    }));
    await page.reload();
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    await expect(page.locator('#today-list .entry')).toHaveCount(0);

    await page.getByRole('button', { name: 'Settings' }).click();
    await page.setInputFiles('#import', file);
    await expect(page.locator('#io-status')).toHaveText('Restored 1 meals.');
    await page.getByRole('button', { name: 'Today' }).click();
    await expect(page.locator('#today-list .entry')).toHaveCount(1);
    await expect(page.locator('#summary .big-num')).toContainText('445');
  });

  test('setup section is folded away in Settings', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Setup (Hari only)')).toBeVisible();
    await expect(page.getByLabel('Gemini API key')).toBeHidden();
  });

  test('offline reload still opens the app via the service worker', async ({ page, context }) => {
    await open(page);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
    });
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    await expect(page.locator('#hero')).toBeVisible();
    await context.setOffline(false);
  });

  test('offline estimate says there is no internet', async ({ page, context }) => {
    await open(page);
    await page.setInputFiles('#upload', new URL('./fixtures/plate.jpg', import.meta.url).pathname);
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Count calories' }).click();
    await expect(page.locator('#failure-text')).toHaveText('No internet. Check your connection and try again.');
    await context.setOffline(false);
  });
});

function readEntries() {
  return new Promise((res) => {
    const r = indexedDB.open('countmakan', 1);
    r.onsuccess = () => {
      const q = r.result.transaction('entries').objectStore('entries').getAll();
      q.onsuccess = () => res(q.result);
    };
  });
}
