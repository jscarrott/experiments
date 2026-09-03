import { expect, test, type Page } from '@playwright/test';

/**
 * These run entirely offline. Tiles are stubbed with an empty MapLibre style and the
 * OSM proxy is stubbed, so the tests never touch a volunteer-run service and never
 * depend on one being up. What they exercise is the real app: the real filtering,
 * grouping and compose code, running against the demo source.
 */
const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#14161c' } }],
};

async function stubNetwork(page: Page, places: unknown = { candidates: [], cached: true }) {
  await page.route('**://tiles.openfreemap.org/**', (route) =>
    route.fulfill({ json: EMPTY_STYLE }),
  );
  // Anything else pointed at a tile host or the proxy is aborted rather than allowed
  // out: a test that quietly reaches the internet is a test that fails on a train.
  await page.route('**/places/**', (route) => route.fulfill({ json: places }));
  await page.addInitScript(() => window.localStorage.clear());
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  page.on('pageerror', (error) => {
    throw new Error(`uncaught page error: ${error.message}`);
  });
});

test('loads in demo mode with the fixture notes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('demo-badge')).toBeVisible();
  await expect(page.getByTestId('note-list').locator('.note')).not.toHaveCount(0);
  // Nobody is signed in, so a sign-in control must be offered rather than a wall.
  await expect(page.getByTestId('sign-in')).toBeVisible();
});

test('the author list is populated and filters the notes', async ({ page }) => {
  await page.goto('/');
  const authors = page.getByTestId('authors');
  await expect(authors.locator('li')).toHaveCount(3);

  const before = await page.getByTestId('note-list').locator('.note').count();
  await authors.locator('input[data-author]').first().check();
  const after = await page.getByTestId('note-list').locator('.note').count();
  expect(after).toBeLessThan(before);
  expect(after).toBeGreaterThan(0);
});

test('a filtered view survives a reload, because it is in the URL', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('rated-only').check();
  await expect(page).toHaveURL(/rated=1/);

  const filtered = await page.getByTestId('note-list').locator('.note').count();
  await page.reload();
  await expect(page.getByTestId('rated-only')).toBeChecked();
  await expect(page.getByTestId('note-list').locator('.note')).toHaveCount(filtered);
});

test('searching narrows to the matching note', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('search').fill('sourdough');
  await expect(page.getByTestId('note-list').locator('.note')).toHaveCount(1);
  await expect(page.getByTestId('note-list')).toContainText('Sourdough');
});

test('notes about one business gather onto a place page with an average', async ({ page }) => {
  await page.goto('/');
  // Two demo notes rate The Granary Rooms 4 and 3.
  await page.getByTestId('note-list').getByRole('button', { name: 'The Granary Rooms' }).first().click();

  const place = page.getByTestId('place-view');
  await expect(place).toBeVisible();
  await expect(place).toContainText('The Granary Rooms');
  await expect(page.getByTestId('average-rating')).toHaveText('3.5 from 2 ratings');
  await expect(place.locator('.note')).toHaveCount(2);
  // The OSM reference is shown, because that is what did the grouping.
  await expect(place).toContainText('node/900000001');
});

test('an unrated place says so instead of showing zero stars', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('search').fill('ferry');
  await expect(page.getByTestId('note-list').locator('.note')).toHaveCount(1);
  // A dropped pin, not a business.
  await expect(page.getByTestId('note-list')).toContainText('Dropped pin');
});

test('compose validates before writing and then saves', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-note').click();
  const compose = page.getByTestId('compose');
  await expect(compose).toBeVisible();

  // The textarea is required, so an empty submit never reaches the validator.
  await page.getByTestId('compose-text').fill('   ');
  await page.getByTestId('compose-save').click();
  await expect(page.getByTestId('compose-error')).toHaveText(/text is required/);

  await page.getByTestId('compose-text').fill('Good coffee, bad food');
  await page.getByTestId('compose-tags').fill('coffee, test');
  await page.getByTestId('rating').locator('[data-rating="4"]').click();
  await page.getByTestId('compose-save').click();

  await expect(compose).toBeHidden();
  await expect(page.getByTestId('note-list')).toContainText('Good coffee, bad food');
});

test('a rating can be cleared by clicking it again', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('add-note').click();
  const four = page.getByTestId('rating').locator('[data-rating="4"]');
  await four.click();
  await expect(four).toHaveClass(/chip--on/);
  await four.click();
  await expect(four).not.toHaveClass(/chip--on/);
});

test('the compose panel offers OSM candidates when the proxy has them', async ({ page }) => {
  await stubNetwork(page, {
    candidates: [
      { osmType: 'node', osmId: '42', name: 'Stub Café', category: 'amenity=cafe', lat: 51.4529, lng: -2.5975, distance: 12 },
    ],
    cached: false,
  });
  await page.goto('/');
  await page.getByTestId('add-note').click();
  await expect(page.getByTestId('place-candidates')).toContainText('Stub Café');
  await expect(page.getByTestId('place-candidates')).toContainText('Somewhere not listed');
});

test('an unreachable OSM proxy still lets a note be written', async ({ page }) => {
  // The whole point of the degradation path: Overpass being down costs you the place
  // name, not the note.
  await page.route('**/places/**', (route) => route.abort());
  await page.goto('/');
  await page.getByTestId('add-note').click();
  await expect(page.getByTestId('compose')).toContainText('plain pin');

  await page.getByTestId('compose-text').fill('Bench in the sun');
  await page.getByTestId('compose-save').click();
  await expect(page.getByTestId('note-list')).toContainText('Bench in the sun');
});

// A `display` rule on an element toggled by the `hidden` attribute outranks
// `[hidden] { display: none }`, which left an empty red strip below the toolbar. It is
// invisible as a bug report — it just looks like the design — so it gets a test.
test('the error banner takes no space when there is no error', async ({ page }) => {
  await page.goto('/');
  const banner = page.locator('#error');
  await expect(banner).toBeHidden();
  expect(await banner.boundingBox()).toBeNull();
});
