import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { KEYS, NASI, geminiBody, deepseekBody, mockModels, seedKeys, open, photoEstimate, settingsRow } from './helpers.js';

const OK = { status: 200, body: geminiBody(NASI) };
const busy = (status) => ({ status, body: { error: { message: 'The model is overloaded' } } });

test('without keys the app asks for a Gemini key', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('heading', { name: 'Add your Gemini key' })).toBeVisible();
  await expect(page.locator('#hero')).toBeHidden();
  // Nothing to count yet, so no empty dashboard.
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('#meals')).toBeHidden();
});

test('blank state reads cleanly on every tab', async ({ page }) => {
  await seedKeys(page);
  await open(page);
  await expect(page.getByRole('heading', { name: 'What are you eating?' })).toBeVisible();
  await expect(page.getByText('Snap it before you eat.')).toBeVisible();
  await expect(page.locator('#summary')).toBeVisible();
  await expect(page.locator('#summary')).not.toContainText('null');
  await expect(page.locator('#summary .split')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText(/\b(null|undefined|NaN)\b/);

  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.locator('#history')).toContainText('No meals saved yet.');
  await page.getByRole('button', { name: 'Add your first meal' }).click();
  await expect(page.locator('#hero')).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('main')).not.toContainText(/\b(null|undefined|NaN)\b/);
});

test('without keys, Add my Gemini key opens Setup with the Gemini guide and DeepSeek folded', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Add my Gemini key' }).click();
  await expect(page.getByLabel('Gemini API key (free)')).toBeVisible();
  await expect(page.getByRole('link', { name: 'aistudio.google.com/apikey' })).toBeVisible();
  await expect(page.getByText('Optional: DeepSeek key (paid)')).toBeVisible();
  await expect(page.getByLabel('DeepSeek API key')).toBeHidden();
  await expect(page.locator('#chain')).toContainText('DeepSeek · deepseek-flash (optional, no key)');
});

test('setup link saves keys, strips them from the address and opens goal setup', async ({ page }) => {
  await open(page, `#setup?gemini=${KEYS.gemini}&deepseek=${KEYS.deepseek}`);
  await expect(page.getByText('Now set your daily goals')).toBeVisible();
  await expect(page.locator('#goals')).toHaveAttribute('open', '');
  await expect(page.getByRole('button', { name: 'Suggest goals' })).toBeVisible();
  expect(page.url()).not.toContain('gemini=');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('countmakan.keys')));
  expect(saved).toEqual(KEYS);
  await page.locator('nav button[data-tab=today]').click();
  await expect(page.locator('#hero')).toBeVisible();
  await expect(page.getByText('Snap it before you eat.')).toBeVisible();
});

test('setup link goes straight to Today when goals are already saved', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('countmakan.targets', '{"kcal":2000}'));
  await open(page, `#setup?gemini=${KEYS.gemini}`);
  await expect(page.getByText("You're all set. Take a photo")).toBeVisible();
  await expect(page.locator('#hero')).toBeVisible();
});

test('saving the first key by hand opens goal setup', async ({ page }) => {
  await open(page);
  await page.locator('nav button[data-tab=settings]').click();
  await page.locator('#setup > summary').click();
  await page.fill('#key-gemini', KEYS.gemini);
  await page.locator('#save-keys').click();
  await expect(page.getByText('Now set your daily goals')).toBeVisible();
  await expect(page.locator('#goals')).toHaveAttribute('open', '');
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
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    await page.getByLabel('Describe your food').fill('2 boiled eggs');
    await page.getByRole('button', { name: 'Count calories' }).click();
    await expect(page.locator('#editor-total')).toHaveText('Total: 155 calories');
    await expect(page.locator('.badge')).toHaveCount(0);
  });

  test('empty text asks the user to type something, without a call', async ({ page }) => {
    const calls = await mockModels(page, {});
    await open(page);
    await page.getByRole('button', { name: 'Type', exact: true }).click();
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

  test('loading covers the screen, shows real steps and says so on fallback', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': busy(503), 'gemini-3.5-flash-lite': 'hang' });
    await open(page);
    await photoEstimate(page);
    await expect(page.getByText("Please wait. You don't need to do anything.")).toBeVisible();
    await expect(page.locator('#step-sent')).toHaveClass('done');
    await expect(page.locator('#step-sent')).toHaveText('Photo sent');
    await expect(page.locator('#step-look')).toHaveText('Trying another way…');
    await expect(page.locator('#loading-hint')).toHaveText('This can take up to a minute.');
    // Nothing behind the wait view can be used.
    await expect(page.locator('header.top')).toHaveAttribute('inert', '');
    await expect(page.locator('main')).toHaveAttribute('inert', '');
    const hit = await page.evaluate(() => {
      const r = document.querySelector('nav button[data-tab=history]').getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('#loading') != null;
    });
    expect(hit).toBe(true); // A tap where the History tab was lands on the wait view.
    await page.getByRole('button', { name: 'Stop and go back' }).click();
    await expect(page.getByRole('heading', { name: 'Is this the right photo?' })).toBeVisible();
    await expect(page.locator('main')).not.toHaveAttribute('inert', '');
  });

  test('text-only loading needs no photo', async ({ page }) => {
    await mockModels(page, { 'gemini-3.8-flash': 'hang' });
    await open(page);
    await page.getByRole('button', { name: 'Type', exact: true }).click();
    await page.getByLabel('Describe your food').fill('nasi goreng with a fried egg');
    await page.getByRole('button', { name: 'Count calories' }).click();
    await expect(page.locator('#step-sent')).toHaveText('Description sent');
    await expect(page.locator('#step-look')).toHaveText('Reading your description');
    await expect(page.locator('#loading-photo')).toBeHidden();
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
    await expect(page.locator('#failure-text')).toHaveText('The app needs fixing. Check the keys in Settings, or tell Hari.');
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
    await expect(page.getByText('Snap it before you eat.')).toBeHidden();

    await page.getByRole('button', { name: 'History' }).click();
    await expect(page.locator('#history .day-total')).toHaveText('445 calories');

    await page.locator('#history .entry').click();
    await expect(page.getByRole('heading', { name: 'Change this meal' })).toBeVisible();
    // The sheet is modal: the tab bar can't be reached until it is closed.
    const covered = await page.evaluate(() => {
      const r = document.querySelector('nav button[data-tab=history]').getBoundingClientRect();
      return !document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('nav');
    });
    expect(covered).toBe(true);
    // Esc (or Android Back) closes it. Nothing changed, so no question asked.
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).not.toHaveAttribute('open', '');
    await page.locator('#today-list .entry').click();
    await page.locator('#item-0-grams').fill('999');
    await page.locator('#item-0-grams').blur();
    page.once('dialog', (dlg) => dlg.dismiss());
    await page.keyboard.press('Escape');
    await expect(page.locator('#sheet')).toHaveAttribute('open', '');
    await expect(page.locator('#item-0-grams')).toHaveValue('999');
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
    await settingsRow(page, 'backup');
    await expect(page.locator('#backup-status')).toHaveText('Never saved');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save a copy' }).click()]);
    await expect(page.locator('#backup-status')).toHaveText(/^Saved \d+ \w+$/);
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
    await expect(page.getByText('Setup (API keys)')).toBeVisible();
    await expect(page.getByLabel('Gemini API key')).toBeHidden();
  });

  test('install card appears when Chrome offers install, and Not now sticks', async ({ page }) => {
    await open(page);
    await expect(page.locator('#install')).toBeHidden();
    const fire = () => page.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      e.prompt = async () => { window.prompted = true; };
      window.dispatchEvent(e);
    });
    await fire();
    await page.getByRole('button', { name: 'Install app' }).click();
    expect(await page.evaluate(() => window.prompted)).toBe(true);
    await expect(page.locator('#install')).toBeHidden();
    await fire();
    await page.getByRole('button', { name: 'Not now' }).click();
    await page.reload();
    await fire();
    await expect(page.locator('#install')).toBeHidden();
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

  test('a new service worker shows an update banner that reloads the app', async ({ page }) => {
    await open(page);
    await expect(page.locator('#update')).toBeHidden();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) await new Promise((r) => navigator.serviceWorker.addEventListener('controllerchange', r));
    });
    // First install took control: still no banner.
    await expect(page.locator('#update')).toBeHidden();
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await expect(page.locator('#update')).toBeVisible();
    await page.locator('nav button[data-tab=history]').click();
    await expect(page.locator('#update')).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update now' }).click()]);
    await page.waitForSelector('body[data-ready]', { state: 'attached' });
    await expect(page.locator('#update')).toBeHidden();
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
