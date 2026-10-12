# countmakan

Calorie counter PWA for Hari's parents. Take a photo, upload one or type a description. Get calories, protein, carbs and fat back.

Live at https://hariadityaa.github.io/countmakan/

## How it works
- Static HTML and JS. No build step and no server.
- The browser calls the model APIs directly. API keys stay in the phone's localStorage.
- Photos are resized to 768 px before the call. Only a 200 px thumbnail is stored, in IndexedDB.
- Each estimate is a list of items: name, grams, kcal, protein, carbs, fat, confidence.
- The user can edit every number before saving. Changing grams rescales the rest.
- Each entry stores the provider, model, token usage and response time.
- Settings has daily goals and backup ("Save a copy" / "Restore from a copy").
- Keys, "Test keys", the setup link and the provider order sit in a folded "Setup (Hari only)" section.

## Screens
- Home: one big "Take a photo of your food" button. "Choose a photo" and "Type what you ate" sit below.
- The photo is shown first ("Is this the right photo?"). Nothing is sent until "Count calories", so a wrong photo costs nothing.
- Loading is a full-screen wait view: "Please wait. You don't need to do anything." Nothing behind it can be tapped.
- Its steps follow real events (sent, looking, results). On fallback the middle step says "Trying another way…". A seconds counter shows it is alive. "Stop and go back" is always there.
- The screen stays awake while waiting (Wake Lock API, where supported).
- Typing a description works without any photo.
- Errors are one plain sentence. The per-provider detail is behind a "Details" toggle.
- Items under 0.6 confidence get a "Please check this" badge.
- Delete is immediate, with an 8 s "Undo".

## Provider chain
Defined in `js/config.js`. Logic never names a model.

| Order | Provider | Model |
|---|---|---|
| 1 | Gemini | `gemini-3.8-flash` |
| 2 | Gemini | `gemini-3.5-flash-lite` |
| 3 | DeepSeek | `deepseek-flash` |

DeepSeek is paid, so it goes last. Its answer is capped at 1,000 tokens.

- The app falls back on 429, 5xx, network errors, a 60 s timeout or unparseable output.
- It stops on other 4xx errors, such as a bad key or bad request.
- It skips a provider with no key, or one whose `supports` list lacks the input type.
- Gemini uses the native `generateContent` endpoint with `responseSchema`. Its OpenAI-compatible endpoint reportedly fails CORS.
- DeepSeek uses `chat/completions` with `response_format: json_object`.

## Setting up a phone
1. On your own phone, open Settings → "Setup (Hari only)", paste the keys, then tap "Test keys".
2. Tap "Copy setup link" and send it privately. Parents only ever use this link. It looks like `https://hariadityaa.github.io/countmakan/#setup?gemini=…&deepseek=…`.
3. Opening the link saves the keys and strips them from the address bar. The `#` fragment never reaches a server.
4. Install from the browser menu: "Add to Home screen".

Treat the setup link like a password. Anyone holding it can spend the keys.

## Data and privacy
- The free Gemini tier may use inputs, including photos, to improve Google products ([terms](https://ai.google.dev/gemini-api/terms)). Hari accepted this. Turning on billing for the key stops it.
- Gemini's free-tier caps aren't published. Secondary sources put Flash at about 20 requests a day and Flash-Lite at about 500. Check AI Studio for the real numbers.

## Development
```
npm ci
npm run lint    # eslint
npm run check   # node --check on every file
npm test        # node:test unit tests
npm run e2e     # Playwright, mocked APIs (not in CI yet)
```
Serve locally with any static server, e.g. `python3 -m http.server`.

- `ci.yml` runs lint, syntax checks and tests on every PR.
- `tests/e2e/` covers the setup link, photo and text estimates, fallback, failures, grams rescaling, save/history/delete/undo, backup round trip and offline reload. It uses `/opt/pw-browsers/chromium` when present.
- `e2e-live.yml` runs by hand, or when its own file changes on main. It first waits for Pages to serve the commit. It runs `tests/live/` against the live site with the repo secrets. It makes 3 photo estimates (Commons photos fetched at run time) and 1 text estimate. It reports provider, time, tokens and totals in the job summary, and uploads screenshots as `live-results`.
- `deploy.yml` deploys Pages from `main` with `actions/deploy-pages`. It stamps the commit into the service-worker cache name.

## Decisions log
- No Cloudflare Worker. Keys live on the device. No passcode.
- DeepSeek is allowed. Hari has a paid account.
- Workers AI was dropped because it needs Cloudflare.
- Defaults: no daily request cap, English UI, targets for kcal, protein, carbs and fat.
- Eval (Nutrition5k plus weighed home meals) is deferred.
