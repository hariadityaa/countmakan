# countmakan

Calorie counter PWA for Hari's parents. Take a photo, upload one or type a description. Get calories and macros back.

Live at https://hariadityaa.github.io/countmakan/

## How it works
- Static HTML and JS. No build step and no server.
- The browser calls the model APIs directly. API keys stay in the phone's localStorage.
- Photos are resized to 1024 px before the call. Only a 200 px thumbnail is stored, in IndexedDB.
- Each estimate is a list of items: name, grams, kcal, protein, carbs, fat, confidence.
- The user can edit every number before saving. Changing grams rescales the rest.
- Each entry stores the provider and model that produced it.
- Settings has JSON export and import, daily targets, and a "Test keys" button.

## Provider chain
Defined in `js/config.js`. Logic never names a model.

| Order | Provider | Model |
|---|---|---|
| 1 | Gemini | `gemini-3.8-flash` |
| 2 | DeepSeek | `deepseek-flash` |
| 3 | Gemini | `gemini-3.5-flash-lite` |

- The app falls back on 429, 5xx, network errors, a 60 s timeout or unparseable output.
- It stops on other 4xx errors, such as a bad key or bad request.
- It skips a provider with no key, or one whose `supports` list lacks the input type.
- Gemini uses the native `generateContent` endpoint with `responseSchema`. Its OpenAI-compatible endpoint reportedly fails CORS.
- DeepSeek uses `chat/completions` with `response_format: json_object`.

## Setting up a phone
1. Open Settings, paste the keys, then tap "Test keys".
2. Or tap "Copy setup link" and send it privately. It looks like `https://hariadityaa.github.io/countmakan/#setup?gemini=…&deepseek=…`.
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
```
Serve locally with any static server, e.g. `python3 -m http.server`.

- `ci.yml` runs lint, syntax checks and tests on every PR.
- `deploy.yml` deploys Pages from `main` with `actions/deploy-pages`. It stamps the commit into the service-worker cache name.

## Decisions log
- No Cloudflare Worker. Keys live on the device. No passcode.
- DeepSeek is allowed. Hari has a paid account.
- Workers AI was dropped because it needs Cloudflare.
- Defaults: no daily request cap, English UI, targets for kcal, protein, carbs and fat.
- Eval (Nutrition5k plus weighed home meals) is deferred.
