import { test, expect } from '@playwright/test';
import { NASI, geminiBody, mockModels, seedKeys, open, photoEstimate } from './helpers.js';

const OK = { status: 200, body: geminiBody(NASI) };
const asking = (items, question, choices) => {
  const body = geminiBody(items);
  body.candidates[0].content.parts[0].text = JSON.stringify({ items, question, choices });
  return body;
};
const promptText = (req) => JSON.parse(req.postData()).contents[0].parts[0].text;

test.beforeEach(async ({ page }) => seedKeys(page));

test('portion buttons scale from the first estimate and never compound', async ({ page }) => {
  await mockModels(page, { 'gemini-3.8-flash': OK });
  await open(page);
  await photoEstimate(page);
  await expect(page.getByText('How much did you eat?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All of it' })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: 'Half', exact: true }).click();
  await expect(page.locator('#editor-total')).toHaveText('Total: 223 calories');
  await page.getByRole('button', { name: 'Half', exact: true }).click();
  await expect(page.locator('#editor-total')).toHaveText('Total: 223 calories');
  await page.getByRole('button', { name: 'Double' }).click();
  await expect(page.locator('#editor-total')).toHaveText('Total: 890 calories');
  await expect(page.locator('#item-0-grams')).toHaveValue('300');

  // A grams edit made at 2× carries back to the base, so All shows the edited item at 1×.
  await page.locator('#item-0-grams').fill('400');
  await page.locator('#item-0-grams').press('Tab');
  await page.getByRole('button', { name: 'All of it' }).click();
  await expect(page.locator('#item-0-grams')).toHaveValue('200');
  await expect(page.locator('#item-0-kcal')).toHaveValue('260');
  await expect(page.locator('#editor-total')).toHaveText('Total: 510 calories');

  await page.getByRole('button', { name: 'Save meal' }).click();
  const saved = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('countmakan', 1);
    r.onsuccess = () => { const q = r.result.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => res(q.result); };
  }));
  expect(saved[0].base).toBeUndefined();
  expect(saved[0].portion).toBeUndefined();
});

test('low confidence asks one question, and the answer goes into a second estimate', async ({ page }) => {
  const SMALL = [{ ...NASI[0], grams: 75, kcal: 98, confidence: 0.95 }, { ...NASI[1], confidence: 0.9 }];
  const bodies = [asking(NASI, 'How much rice did you eat?', ['Half plate', 'Full plate']), asking(SMALL, 'Another?', ['a', 'b'])];
  const prompts = [];
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    prompts.push(promptText(route.request()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bodies[prompts.length - 1]) });
  });
  await open(page);
  await photoEstimate(page);
  await expect(page.getByText('One quick question')).toBeVisible();
  await expect(page.getByText('How much rice did you eat?')).toBeVisible();
  await page.getByRole('button', { name: 'Half plate' }).click();

  await expect(page.locator('#editor-total')).toHaveText('Total: 348 calories');
  await expect(page.locator('#ask')).toHaveCount(0); // never a second round
  expect(prompts).toHaveLength(2);
  expect(prompts[1]).toContain('You asked: "How much rice did you eat?" The eater answered: "Half plate"');
});

test('no question when the model is confident', async ({ page }) => {
  const sure = NASI.map((i) => ({ ...i, confidence: 0.9 }));
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: asking(sure, 'Rice?', ['a', 'b']) } });
  await open(page);
  await photoEstimate(page);
  await expect(page.locator('#editor-total')).toBeVisible();
  await expect(page.locator('#ask')).toHaveCount(0);
});

test('a typed answer works too', async ({ page }) => {
  let n = 0;
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    n += 1;
    const body = n === 1 ? asking(NASI, 'How much rice?', ['Half']) : geminiBody(NASI);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await open(page);
  await photoEstimate(page);
  await page.getByLabel('Something else?').fill('two scoops');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(page.locator('#ask')).toHaveCount(0);
  expect(n).toBe(2);
});

test('favourites: save one, log it again with no call, and send its portions as references', async ({ page }) => {
  const prompts = [];
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    prompts.push(promptText(route.request()));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(geminiBody(NASI)) });
  });
  await open(page);
  await expect(page.locator('#favs')).toBeHidden();
  await photoEstimate(page);
  await page.getByRole('button', { name: '☆ Save as a favourite' }).click();
  await expect(page.locator('#toast')).toHaveText(/Saved as a favourite/);
  await expect(page.getByRole('button', { name: '★ Remove from favourites' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Save meal' }).click();

  await expect(page.locator('#favs')).toBeVisible();
  await expect(page.locator('#fav-list .entry')).toHaveCount(1);
  await page.locator('#fav-list .entry').click();
  await expect(page.locator('#editor-total')).toHaveText('Total: 445 calories');
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#today-list .entry')).toHaveCount(2);
  expect(prompts).toHaveLength(1);

  // Survives a reload.
  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  await expect(page.locator('#fav-list .entry')).toHaveCount(1);

  await photoEstimate(page);
  await expect(page.locator('#editor-total')).toBeVisible();
  expect(prompts[1]).toContain('- Nasi putih: 150 g, 195 kcal');
  expect(prompts[1]).toContain('- Rendang sapi: 80 g, 250 kcal');
  await page.getByRole('button', { name: "Don't save" }).click();

  // Removing it from the favourite's own editor hides the card.
  await page.locator('#fav-list .entry').click();
  await page.getByRole('button', { name: '★ Remove from favourites' }).click();
  await page.getByRole('button', { name: "Don't save" }).click();
  await expect(page.locator('#favs')).toBeHidden();
});

test('I ate this again copies a past meal as a new one', async ({ page }) => {
  const calls = await mockModels(page, { 'gemini-3.8-flash': OK });
  await open(page);
  await photoEstimate(page);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await page.locator('#today-list .entry').first().click();
  await page.getByRole('button', { name: 'I ate this again' }).click();
  await expect(page.getByRole('heading', { name: "Here's what we found" })).toBeVisible();
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#today-list .entry')).toHaveCount(2);
  await expect(page.locator('#summary .big-num')).toContainText('890');
  expect(calls).toEqual(['gemini-3.8-flash']);
});

test('sugar, fibre and sodium show per item, in the total and on Today', async ({ page }) => {
  const items = [{ ...NASI[0], sugar: 0.1, fibre: 0.6, sodium: 2 }, { ...NASI[1], sugar: 2, fibre: 1.5, sodium: 700 }];
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(items) } });
  await open(page);
  await photoEstimate(page);
  await expect(page.locator('#item-1-sodium')).toHaveValue('700');
  await expect(page.locator('#editor-extra')).toHaveText('Sugar 2 g · Fibre 2 g · Sodium 702 mg');
  await page.getByRole('button', { name: 'Save meal' }).click();
  await expect(page.locator('#summary')).toContainText('702 mg of 2,000 mg');
  await expect(page.locator('#summary')).toContainText('2 g of 25 g');
});
