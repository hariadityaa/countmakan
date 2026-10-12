import { test, expect } from '@playwright/test';
import { NASI, geminiBody, mockModels, seedKeys, open, photoEstimate } from './helpers.js';

// Stands in for Google's sign-in script. Each requestAccessToken returns a fresh token.
const FAKE_GIS = `
  let n = 0;
  window.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'tok' + (++n), expires_in: 3599, scope: cfg.scope })) }),
    hasGrantedAllScopes: () => true,
    revoke: (_t, cb) => cb && cb(),
  } } };`;

// Records Health API calls. Created logs are named n/1, n/2, ...
async function mockHealth(page) {
  const calls = [];
  await page.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE_GIS }));
  await page.route(/health\.googleapis\.com/, async (route) => {
    const req = route.request();
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    calls.push({ method: req.method(), url: req.url(), body });
    const created = calls.filter((c) => c.method === 'POST' && !c.url.includes(':batchDelete')).length;
    const reply = req.method() === 'POST' && !req.url().includes(':batchDelete')
      ? { done: true, response: { name: `n/${created}` } }
      : { done: true };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return calls;
}

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
