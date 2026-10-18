import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4174',
    acceptDownloads: true,
    launchOptions: {
      // The image ships one Chromium build, which may not match the one this
      // @playwright/test version would download. Point at the installed binary
      // rather than fetching another copy.
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    },
  },
  webServer: {
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
