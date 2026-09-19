import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser',
  use: { timezoneId: 'UTC', baseURL: 'http://127.0.0.1:8001', channel: process.env.CI ? undefined : 'chrome' },
  webServer: {
    command: 'python3 -m http.server 8001 --bind 127.0.0.1 --directory dist',
    url: 'http://127.0.0.1:8001', reuseExistingServer: false,
  },
});
