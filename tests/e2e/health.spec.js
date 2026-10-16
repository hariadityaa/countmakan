import { test, expect } from '@playwright/test';
import { NASI, geminiBody, mockModels, seedKeys, open, photoEstimate, mockHealth, connect } from './helpers.js';

const posts = (calls) => calls.filter((c) => c.method === 'POST' && !c.url.includes(':batchDelete'));
const deletes = (calls) => calls.filter((c) => c.url.includes(':batchDelete'));

test.beforeEach(async ({ page }) => seedKeys(page));

test('connected: save sends the meal, edit replaces it, delete removes it after undo window', async ({ page }) => {
  test.setTimeout(45000);
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await open(page);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#health-status')).toHaveText(/Send each new meal/);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.locator('#toast')).toHaveText('Connected to Google Health ✓');
  await expect(page.locator('#health-status')).toHaveText(/^On\./);

  await page.getByRole('button', { name: 'Today' }).click();
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect.poll(() => posts(calls).length).toBe(1);
  const log = posts(calls)[0].body.nutritionLog;
  expect(log.foodDisplayName).toBe('Rendang sapi, Nasi putih');
  expect(log.energy).toEqual({ kcal: 445 });
  expect(log.nutrients).toEqual([{ nutrient: 'PROTEIN', quantity: { grams: 22 } }]);

  await page.locator('#today-list .entry').click();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => posts(calls).length).toBe(2);
  expect(deletes(calls).map((c) => c.body.names)).toEqual([['n/1']]);

  await page.locator('#today-list .entry').click();
  await page.getByRole('button', { name: 'Delete this meal' }).click();
  await page.waitForTimeout(1000);
  expect(deletes(calls)).toHaveLength(1); // Still inside the undo window.
  await expect.poll(() => deletes(calls).length, { timeout: 15000 }).toBe(2);
  expect(deletes(calls)[1].body.names).toEqual(['n/2']);
});

test('undo inside the window keeps the Google Health log', async ({ page }) => {
  test.setTimeout(45000);
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Connect' }).click();
  await page.getByRole('button', { name: 'Today' }).click();
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect.poll(() => posts(calls).length).toBe(1);

  await page.locator('#today-list .entry').click();
  await page.getByRole('button', { name: 'Delete this meal' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(10500);
  expect(deletes(calls)).toHaveLength(0);
  expect(posts(calls)).toHaveLength(1);
});

test('expired sign-in shows a send card on Today, one tap sends', async ({ page }) => {
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('countmakan.health', 'true');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await open(page);
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#health-sync')).toBeVisible();
  await expect(page.locator('#health-sync-text')).toHaveText('1 meal is not in Google Health yet.');
  expect(posts(calls)).toHaveLength(0);

  await page.getByRole('button', { name: 'Send to Google Health' }).click();
  await expect(page.locator('#toast')).toHaveText('Sent to Google Health ✓');
  await expect(page.locator('#health-sync')).toBeHidden();
  expect(posts(calls)).toHaveLength(1);
});

test('expired sign-in: saving offers Send, Settings offers Send now', async ({ page }) => {
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('countmakan.health', 'true');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await open(page);
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#toast-text')).toHaveText('Meal saved. Not in Google Health yet.');
  if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/toast.png` });

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#health-status')).toContainText('1 meal is waiting to send.');
  await page.locator('#health-signin').scrollIntoViewIfNeeded();
  if (process.env.SHOT_DIR) {
    await page.evaluate(() => { document.querySelector('#toast').hidden = true; document.querySelector('#health-signin').scrollIntoView({ block: 'center' }); });
    await page.screenshot({ path: `${process.env.SHOT_DIR}/settings.png` });
  }
  await page.getByRole('button', { name: 'Send now' }).click();
  await expect(page.locator('#toast')).toHaveText('Sent to Google Health ✓');
  await expect(page.locator('#health-signin')).toBeHidden();
  expect(posts(calls)).toHaveLength(1);
});

test('off by default: saving a meal calls nothing', async ({ page }) => {
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await open(page);
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#toast')).toHaveText(/Meal saved/);
  await expect(page.locator('#health-sync')).toBeHidden();
  expect(calls).toHaveLength(0);
});

test('sync off: new meals stay local, deletes wait, past meals send on demand', async ({ page }) => {
  test.setTimeout(45000);
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(NASI) } });
  const calls = await mockHealth(page);
  await open(page);
  await connect(page);
  await page.getByRole('button', { name: 'Today' }).click();
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect.poll(() => posts(calls).length).toBe(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Send new meals' }).uncheck();
  await expect(page.locator('#health-status')).toHaveText(/^Off\. New meals stay in this app only\./);
  await expect(page.locator('#health-past')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();

  await page.getByRole('button', { name: 'Today' }).click();
  await page.locator('#today-list .entry').click();
  await page.getByRole('button', { name: 'Delete this meal' }).click();
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#toast')).toHaveText(/Meal saved/);
  await page.waitForTimeout(10500);
  expect(calls).toHaveLength(1);

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.locator('#health-status')).toHaveText(/1 change waits until you turn it back on/);
  await page.getByRole('switch', { name: 'Send new meals' }).check();
  await expect.poll(() => deletes(calls).length).toBe(1);
  expect(deletes(calls)[0].body.names).toEqual(['n/1']);
  expect(posts(calls)).toHaveLength(1); // The meal saved while off is not sent by itself.

  await expect(page.locator('#health-past-text')).toHaveText('1 meal in the last 7 days not sent yet.');
  await page.getByRole('button', { name: 'Send 1 meal' }).click();
  await expect(page.locator('#toast')).toHaveText('Sent 1 meal to Google Health ✓');
  expect(posts(calls)).toHaveLength(2);
  await expect(page.locator('#health-past')).toBeHidden();
});

test('send past meals respects the chosen range', async ({ page }) => {
  const calls = await mockHealth(page);
  await open(page);
  await page.evaluate(() => new Promise((res) => {
    const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d; };
    const item = { name: 'Nasi lemak', grams: 200, kcal: 400, protein: 10, carbs: 50, fat: 15, confidence: 1 };
    const rows = [0, 10, 60].map((n) => {
      const d = daysAgo(n);
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { id: `seed-${n}`, ts: d.toISOString(), day, items: [item], text: '' };
    });
    const r = indexedDB.open('countmakan', 1);
    r.onsuccess = () => {
      const t = r.result.transaction('entries', 'readwrite');
      rows.forEach((e) => t.objectStore('entries').put(e));
      t.oncomplete = res;
    };
  }));
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  await connect(page);
  expect(calls).toHaveLength(0); // Connecting sends nothing from the past.

  const text = page.locator('#health-past-text');
  await expect(text).toHaveText('1 meal in the last 7 days not sent yet.');
  await page.getByRole('button', { name: '30 days' }).click();
  await expect(text).toHaveText('2 meals in the last 30 days not sent yet.');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(text).toHaveText('3 meals in total not sent yet.');

  await page.getByRole('button', { name: '30 days' }).click();
  await page.getByRole('button', { name: 'Send 2 meals' }).click();
  await expect(page.locator('#toast')).toHaveText('Sent 2 meals to Google Health ✓');
  expect(posts(calls)).toHaveLength(2);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expect(text).toHaveText('1 meal in total not sent yet.');
});
