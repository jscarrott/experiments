import { expect, test, type Page } from '@playwright/test';

/**
 * The phone layout, which is a different arrangement rather than the same one squeezed:
 * the map fills the screen and both sidebars float over it. These run at a phone
 * viewport; every other spec runs at the default desktop size, where none of this CSS
 * applies.
 */
// Carries an attribution, unlike the stub the other spec uses: MapLibre only renders the
// attribution control for sources that declare one, and this spec asserts where it lands.
const EMPTY_STYLE = {
  version: 8,
  sources: {
    blank: {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#14161c' } },
    // A layer has to actually use the source, or MapLibre never counts its attribution.
    { id: 'blank', type: 'circle', source: 'blank' },
  ],
};

async function stubNetwork(page: Page) {
  await page.route('**://tiles.openfreemap.org/**', (route) => route.fulfill({ json: EMPTY_STYLE }));
  await page.route('**/places/**', (route) => route.fulfill({ json: { candidates: [], cached: true } }));
  await page.addInitScript(() => window.localStorage.clear());
}

test.use({ viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  page.on('pageerror', (error) => {
    throw new Error(`uncaught page error: ${error.message}`);
  });
});

test('the map fills the screen and the sheet peeks with a count', async ({ page }) => {
  await page.goto('/');
  const map = await page.locator('#map').boundingBox();
  const viewport = page.viewportSize()!;
  // The old layout gave the map a fixed 300px band below every filter control.
  expect(map!.height).toBeGreaterThan(viewport.height * 0.6);

  await expect(page.getByTestId('sheet-handle')).toContainText(/note[s]? in view/);
  await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'false');
});

// The scrim is styled `display: block` inside the phone media query, which beats the
// `hidden` attribute's `display: none`. Driving it from the `hidden` attribute therefore
// left an invisible sheet of glass over the whole map that swallowed every tap, with
// nothing to see in a screenshot.
test('nothing invisible covers the map while the panels are closed', async ({ page }) => {
  await page.goto('/');
  const viewport = page.viewportSize()!;
  const topmost = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.tagName ?? 'NONE',
    [viewport.width / 2, viewport.height / 2],
  );
  expect(topmost).toBe('CANVAS');
});

test('the sheet opens to the notes and closes again', async ({ page }) => {
  await page.goto('/');
  const handle = page.getByTestId('sheet-handle');

  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('note-list').locator('.note').first()).toBeInViewport();

  await handle.click();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
});

test('the filter panel slides over the map and Escape dismisses it', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByTestId('toggle-filters');
  await expect(page.getByTestId('search')).not.toBeInViewport();

  await toggle.click();
  await expect(page.getByTestId('search')).toBeInViewport();

  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('search')).not.toBeInViewport();
});

// Using the tiles is conditional on showing the attribution, so it has to stay clear of
// the sheet rather than sitting behind its peek.
test('the OpenStreetMap attribution is not hidden behind the sheet', async ({ page }) => {
  await page.goto('/');
  const attribution = await page.locator('.maplibregl-ctrl-attrib').first().boundingBox();
  const sheet = await page.locator('#sheet').boundingBox();
  expect(attribution).not.toBeNull();
  expect(attribution!.y + attribution!.height).toBeLessThanOrEqual(sheet!.y + 1);
});

test('composing opens the sheet, so the form is not left below the fold', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-note').click();
  await expect(page.getByTestId('sheet-handle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('compose-text')).toBeInViewport();
});
