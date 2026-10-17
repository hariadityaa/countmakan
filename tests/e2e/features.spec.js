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
  await page.getByRole('button', { name: 'Save as a favourite' }).click();
  await expect(page.locator('#toast')).toHaveText(/Saved as a favourite/);
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute('aria-pressed', 'true');
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
  await page.getByRole('button', { name: 'Remove from favourites' }).click();
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

test('suggest fills the goals without saving, and the user can override before saving', async ({ page }) => {
  await open(page);
  await page.locator('nav button[data-tab=settings]').click();
  await page.getByText('Not sure? Suggest for me').click();
  await page.getByRole('button', { name: 'Suggest goals' }).click();
  await expect(page.locator('#suggest-status')).toHaveText('Choose male or female.');

  await page.selectOption('#p-sex', 'female');
  await page.fill('#p-age', '62');
  await page.fill('#p-height', '155');
  await page.fill('#p-weight', '58');
  await page.selectOption('#p-activity', 'walking');
  await expect(page.locator('#p-hint')).toContainText('BMI 24.1');
  await expect(page.locator('#p-goal')).toHaveValue('keep');
  await page.getByRole('button', { name: 'Suggest goals' }).click();
  await expect(page.locator('#t-kcal')).toHaveValue('1480');
  await expect(page.locator('#t-protein')).toHaveValue('58');
  expect(await page.evaluate(() => localStorage.getItem('countmakan.targets'))).toBeNull();

  await page.fill('#t-kcal', '1550');
  await page.getByRole('button', { name: 'Save goals' }).click();
  const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('countmakan.targets')));
  expect(saved).toMatchObject({ kcal: 1550, protein: 58, carbs: 202, fat: 49 });
});

// Draws a w×h JPEG in the page, so a phone-sized photo needs no fixture file.
async function bigPhoto(page, w, h) {
  const b64 = await page.evaluate(([w, h]) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `hsl(${i * 37 % 360} 70% 50%)`;
      g.fillRect((i * 97) % w, (i * 53) % h, w / 8, h / 8);
    }
    return c.toDataURL('image/jpeg', 0.95).split(',')[1];
  }, [w, h]);
  return { name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

const imageSize = (page, b64) => page.evaluate(async (d) => {
  const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${d}`)).blob());
  return [bmp.width, bmp.height];
}, b64);

test('a large photo goes to the model at 1536 px and the diary keeps 2048 px', async ({ page }) => {
  let sent = '';
  await page.route(/generativelanguage\.googleapis\.com/, async (route) => {
    sent = JSON.parse(route.request().postData()).contents[0].parts[1].inline_data.data;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(geminiBody(NASI)) });
  });
  await open(page);
  await page.setInputFiles('#upload', await bigPhoto(page, 4000, 3000));
  await page.getByRole('button', { name: 'Count calories' }).click();
  await expect(page.locator('#editor-total')).toBeVisible();
  expect(await imageSize(page, sent)).toEqual([1536, 1152]);
  await expect(page.locator('#scan-details')).toContainText(/photo \d+ KB/);
  await page.getByRole('button', { name: 'Save meal' }).click();
  const kept = await page.evaluate(async () => {
    const db = await new Promise((r) => { const q = indexedDB.open('countmakan'); q.onsuccess = () => r(q.result); });
    const [e] = await new Promise((r) => { const q = db.transaction('entries').objectStore('entries').getAll(); q.onsuccess = () => r(q.result); });
    const bmp = await createImageBitmap(e.photo);
    return [bmp.width, bmp.height];
  });
  expect(kept).toEqual([2048, 1536]);
});

test('scan details show each step and its time after a fallback, and are saved', async ({ page }) => {
  await mockModels(page, { 'gemini-3.8-flash': { status: 503, body: { error: { message: 'busy' } } }, 'gemini-3.5-flash-lite': OK });
  await open(page);
  await photoEstimate(page);
  await expect(page.locator('#scan-details')).toHaveText(/^Scan: gemini-3\.8-flash failed \(503\) after \d+\.\d s → gemini-3\.5-flash-lite \d+\.\d s · photo \d+ KB$/);
  await page.getByRole('button', { name: 'Save meal' }).click();
  await page.locator('button.entry').first().click();
  await expect(page.locator('#scan-details')).toContainText('gemini-3.5-flash-lite');
});

test('provider order can be changed in Settings, is used for the next scan and can be reset', async ({ page }) => {
  const calls = await mockModels(page, { 'gemini-3.5-flash-lite': OK });
  await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#setup summary').first().click();
  const steps = page.locator('#chain li');
  await expect(steps).toHaveText([/gemini-3\.8-flash/, /gemini-3\.5-flash-lite/, /deepseek-flash/]);
  await expect(page.getByRole('button', { name: 'Move Gemini · gemini-3.8-flash up' })).toBeDisabled();
  await expect(page.locator('#reset-order')).toBeHidden();

  await page.getByRole('button', { name: 'Move Gemini · gemini-3.5-flash-lite up' }).click();
  await expect(steps).toHaveText([/gemini-3\.5-flash-lite/, /gemini-3\.8-flash/, /deepseek-flash/]);
  await expect(page.getByRole('button', { name: 'Move Gemini · gemini-3.5-flash-lite down' })).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('countmakan.order'))))
    .toEqual(['gemini:gemini-3.5-flash-lite', 'gemini:gemini-3.8-flash', 'deepseek:deepseek-flash']);

  await page.reload();
  await page.waitForSelector('body[data-ready]', { state: 'attached' });
  await page.getByRole('button', { name: 'Today' }).click();
  await photoEstimate(page);
  await expect(page.locator('#editor-total')).toBeVisible();
  expect(calls).toEqual(['gemini-3.5-flash-lite']);

  await page.getByRole('button', { name: "Don't save" }).click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.locator('#setup summary').first().click();
  await page.locator('#reset-order').click();
  await expect(steps).toHaveText([/gemini-3\.8-flash/, /gemini-3\.5-flash-lite/, /deepseek-flash/]);
  expect(await page.evaluate(() => localStorage.getItem('countmakan.order'))).toBeNull();
});

test('item note is collapsed, editable and saved', async ({ page }) => {
  const items = [{ ...NASI[0], detail: 'plain, steamed' }, NASI[1]];
  await mockModels(page, { 'gemini-3.8-flash': { status: 200, body: geminiBody(items) } });
  await open(page);
  await photoEstimate(page);

  const note = page.locator('#item-0-detail');
  await expect(note).toBeHidden();
  await expect(page.locator('.item-note summary')).toHaveText(['Note', 'Add note']);
  await page.locator('.item-note summary').first().click();
  await expect(note).toHaveValue('plain, steamed');
  await note.fill('with egg');
  await note.blur();
  await page.getByRole('button', { name: 'Save meal' }).click();

  await page.locator('#today-list .entry').click();
  await page.locator('.item-note summary').first().click();
  await expect(page.locator('#item-0-detail')).toHaveValue('with egg');
});
