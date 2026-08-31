import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: {
      // The image ships one Chromium build, which may not match the one this
      // @playwright/test version would download. Point at the installed binary
      // rather than fetching another copy.
      executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
      // MapLibre needs WebGL, and headless Chromium has no GPU, so the software
      // rasteriser has to be turned on explicitly or the map canvas is blank.
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    // Built here rather than reusing dist/, with the OSM proxy URL configured, because
    // that URL is a build-time constant: an unconfigured production build skips the
    // lookup entirely, so the stubbed-proxy tests would have nothing to intercept.
    // A separate outDir keeps the real dist/ free of this test-only value.
    command:
      'npx vite build --outDir dist-e2e && npx vite preview --outDir dist-e2e --port 4173 --strictPort',
    env: { VITE_PLACES_URL: 'http://127.0.0.1:8787' },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
