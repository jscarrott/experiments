import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    launchOptions: {
      // The image ships one Chromium build, which may not match the one this
      // @playwright/test version would download. Point at the installed binary
      // rather than fetching another copy.
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
      // Headless Chromium has no GPU, so WebGL needs the software rasteriser
      // turned on explicitly or the canvas comes back blank.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
