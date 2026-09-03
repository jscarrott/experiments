import { expect, test, type Page } from '@playwright/test';

/**
 * "Note where I am", with the browser's position faked. This is the flow the app exists
 * for — stood outside the place, wanting to write about it — and it is the one that
 * cannot be exercised by hand on a desktop.
 */
const EMPTY_STYLE = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#14161c' } }],
};

// Bristol, near the demo fixtures.
const HERE = { latitude: 51.4529, longitude: -2.5975 };

async function stubNetwork(page: Page) {
  await page.route('**://tiles.openfreemap.org/**', (route) => route.fulfill({ json: EMPTY_STYLE }));
  await page.route('**/places/**', (route) =>
    route.fulfill({ json: { candidates: [{ name: 'The Granary Rooms', osmType: 'node', osmId: 1, lat: HERE.latitude, lng: HERE.longitude, distance: 8 }], cached: true } }),
  );
  await page.addInitScript(() => window.localStorage.clear());
}

test.beforeEach(async ({ page }) => {
  await stubNetwork(page);
  page.on('pageerror', (error) => {
    throw new Error(`uncaught page error: ${error.message}`);
  });
});

test.describe('with location allowed', () => {
  test.use({ permissions: ['geolocation'], geolocation: { ...HERE, accuracy: 9 } });

  test('opens a note at the device position, and says how precise it is', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();

    await expect(page.getByTestId('compose')).toBeVisible();
    await expect(page.getByTestId('compose-point')).toContainText('51.45290');
    await expect(page.getByTestId('compose-point')).toContainText('give or take 9m');
    // A good fix is not worth a warning.
    await expect(page.getByTestId('coarse-fix')).toHaveCount(0);
    await expect(page.getByTestId('draft-pin')).toHaveCount(1);
  });

  test('the nearby business is offered without having to find it on the map', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();
    await expect(page.getByTestId('place-candidates')).toContainText('The Granary Rooms');
  });
});

test.describe('with a fix too coarse to trust', () => {
  test.use({ permissions: ['geolocation'], geolocation: { ...HERE, accuracy: 180 } });

  // 180m covers most of a high street, and writing a review of the wrong shop is the
  // failure this is guarding against.
  test('says the fix is rough and asks for the pin to be moved', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();
    await expect(page.getByTestId('coarse-fix')).toBeVisible();
  });

  test('dragging the pin drops the uncertainty, because the point is now chosen', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();
    await expect(page.getByTestId('coarse-fix')).toBeVisible();

    const pin = page.getByTestId('draft-pin');
    const box = (await pin.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 40, { steps: 10 });
    await page.mouse.up();

    await expect(page.getByTestId('coarse-fix')).toHaveCount(0);
    await expect(page.getByTestId('compose-point')).not.toContainText('give or take');
  });
});

test.describe('with location refused', () => {
  // No `permissions`, so the browser denies.
  test('explains the refusal and names the alternative', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();

    const banner = page.locator('#error');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/refused/i);
    await expect(banner).toContainText(/tap the map/i);
    // Refusing must not leave a half-started note behind.
    await expect(page.getByTestId('compose')).toHaveCount(0);
  });

  test('the button does not stay stuck on "Finding you…"', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();
    await expect(page.getByTestId('note-here')).toHaveText('Note where I am');
    await expect(page.getByTestId('note-here')).toBeEnabled();
  });
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true,
    permissions: ['geolocation'], geolocation: { ...HERE, accuracy: 180 },
  });

  // Being told to drag a pin that is behind the sheet is worse than not being told.
  test('the draft pin stays visible above the sheet', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('note-here').click();
    await expect(page.getByTestId('coarse-fix')).toBeVisible();
    await page.waitForTimeout(1600); // the flyTo

    const pin = (await page.getByTestId('draft-pin').boundingBox())!;
    const sheet = (await page.locator('#sheet').boundingBox())!;
    expect(pin.y + pin.height).toBeLessThanOrEqual(sheet.y + 1);
  });
});
