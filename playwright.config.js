import { defineConfig } from '@playwright/test';
import fs from 'node:fs';

// Use a preinstalled Chromium when there is one (set CHROMIUM to point at it);
// otherwise Playwright's own (npx playwright install chromium), as in CI.
const preinstalled = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const executablePath = fs.existsSync(preinstalled) ? preinstalled : undefined;
const iphoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /.*\.spec\.mjs/,
  timeout: 60000,
  workers: 1, // tests share one mock Sheet
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173', launchOptions: { executablePath }, serviceWorkers: 'allow' },
  projects: [
    { name: 'iphone-size', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: iphoneUA } },
    { name: 'android-size', use: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1366, height: 860 } } },
  ],
  webServer: [
    // The test build's security policy also allows the local mock Sheet
    { command: 'npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 60000, env: { TRIP_CSP_EXTRA_CONNECT: 'http://localhost:8787' } },
    { command: 'node dev/mock-server.mjs', port: 8787, reuseExistingServer: true, env: { DELAY: '50' } },
  ],
});
