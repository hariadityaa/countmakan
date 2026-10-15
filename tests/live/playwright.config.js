import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

// Real model calls against the deployed site. Run by e2e-live.yml only.
const SANDBOX_CHROMIUM = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.js',
  timeout: 240000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.LIVE_URL || 'https://hurrymeow.github.io/countmakan/',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    // No trace, video or HAR: they would record request headers, which carry the keys.
    trace: 'off',
    video: 'off',
    launchOptions: existsSync(SANDBOX_CHROMIUM) ? { executablePath: SANDBOX_CHROMIUM } : {},
  },
});
